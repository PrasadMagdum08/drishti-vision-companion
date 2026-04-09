import React, { useEffect, useRef, useCallback, useState } from "react";
import { StyleSheet, View, Text, Pressable, Vibration } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import { useIsFocused } from "@react-navigation/native";
import RNFS from "react-native-fs";
import Tts from "react-native-tts";
import { useStore } from "../../core/store/useStore";
import { useVoice } from "../voice/useVoice";
// import { useWakeWord, WakeWordController } from "../voice/useWakeWord";

const FRAME_INTERVAL_MS = 125;
const FRAME_QUALITY = 35;

const TTS_RATE_NORMAL = 0.52;
const TTS_RATE_FAST = 0.62;

const CRITICAL_PREFIXES = [
  "fast car",
  "fast motorcycle",
  "fast bus",
  "fast truck",
];

const CameraStream = () => {
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const isFocused = useIsFocused();

  const {
    isConnected,
    connect,
    sendFrame,
    socket, // Needed for direct frame sends
    sendRaw,
    lastAlert,
    lastMessageType,
    lastMessagePriority,
    lastMessageFast,
  } = useStore();
  const { isListening, startListening, stopListening } = useVoice();

  const isTtsSpeaking = useRef(false);
  const [isSpeakingState, setIsSpeakingState] = useState(false);

  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ttsQueue = useRef<Array<{ text: string; fast: boolean }>>([]);
  const isSpeaking = useRef(false);

  const speakNext = useCallback(() => {
    if (ttsQueue.current.length === 0) {
      isSpeaking.current = false;
      isTtsSpeaking.current = false;
      setIsSpeakingState(false);
      return;
    }
    isSpeaking.current = true;
    isTtsSpeaking.current = true;
    setIsSpeakingState(true);

    const next = ttsQueue.current.shift()!;
    Tts.setDefaultRate(next.fast ? TTS_RATE_FAST : TTS_RATE_NORMAL);
    Tts.speak(next.text);
  }, []);

  const enqueueAlert = useCallback(
    (alert: string, priority: boolean, messageType: string, fast: boolean) => {
      const alertLower = alert.toLowerCase();
      const isCritical =
        CRITICAL_PREFIXES.some((p) => alertLower.startsWith(p)) ||
        (alertLower.includes("0.5 meters") &&
          ["car", "motorcycle", "bus", "truck"].some((v) =>
            alertLower.includes(v),
          ));

      if (isCritical) {
        ttsQueue.current = [{ text: alert, fast: true }];
        Tts.stop();
        isSpeaking.current = false;
        speakNext();
        return;
      }

      if (
        priority ||
        messageType === "description" ||
        messageType === "read_text"
      ) {
        ttsQueue.current = [{ text: alert, fast: false }];
        if (!isSpeaking.current) speakNext();
        return;
      }

      if (ttsQueue.current.length >= 4)
        ttsQueue.current = ttsQueue.current.slice(-3);
      ttsQueue.current.push({ text: alert, fast });

      if (!isSpeaking.current) speakNext();
    },
    [speakNext],
  );

  // ✅ WAKE WORD COMPLETELY DISABLED FOR VISION MODULE
  /*
  const handleWakeWord = useCallback(() => {
    if (isListening || !isFocused) return;
    ttsQueue.current = [];
    isSpeaking.current = false;
    startListening();
  }, [isListening, startListening, isFocused]);

  useWakeWord(handleWakeWord);

  useEffect(() => {
    if (isSpeakingState) {
      WakeWordController.pause("TTS");
    } else {
      WakeWordController.resume("TTS");
    }
  }, [isSpeakingState]);
  */

  useEffect(() => {
    Tts.setDefaultLanguage("en-IN");
    Tts.setDefaultRate(TTS_RATE_NORMAL);
    Tts.getInitStatus()
      .then(() => {
        Tts.speak("Guardian Active. Double tap to describe scene.");
      })
      .catch(() => {});

    const finishListener = () => {
      isSpeaking.current = false;
      isTtsSpeaking.current = false;
      setIsSpeakingState(false);
      speakNext();
    };

    Tts.addEventListener("tts-finish", finishListener);
    return () => Tts.removeEventListener("tts-finish", finishListener);
  }, [speakNext]);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!lastAlert || isListening || !isFocused) return;
    enqueueAlert(
      lastAlert,
      lastMessagePriority ?? false,
      lastMessageType ?? "",
      lastMessageFast ?? false,
    );
  }, [
    lastAlert,
    lastMessageType,
    lastMessagePriority,
    lastMessageFast,
    isListening,
    isFocused,
    enqueueAlert,
  ]);

  useEffect(() => {
    if (!isConnected || isListening || !isFocused) return;
    let isProcessing = false;
    const interval = setInterval(async () => {
      if (!camera.current || isProcessing) return;
      isProcessing = true;
      try {
        const photo = await camera.current.takeSnapshot({
          quality: FRAME_QUALITY,
        });
        if (photo?.path) {
          const base64 = await RNFS.readFile(photo.path, "base64");
          if (base64 && base64.length > 100) sendFrame(base64);
          await RNFS.unlink(photo.path);
        }
      } catch {
      } finally {
        isProcessing = false;
      }
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isConnected, isListening, sendFrame, isFocused]);

  // ✅ NEW DIRECT FRAME CAPTURE FOR SCENE DESCRIPTION
  const captureAndDescribe = useCallback(async () => {
    if (!camera.current || !isConnected || !socket || !isFocused) return;
    try {
      const photo = await camera.current.takeSnapshot({ quality: FRAME_QUALITY });
      if (photo?.path) {
        const base64 = await RNFS.readFile(photo.path, "base64");
        await RNFS.unlink(photo.path).catch(() => {});
        socket.send(JSON.stringify({ type: "audio_command", action: "describe", frame: base64 }));
      }
    } catch (e) {
      console.error("Capture error:", e);
    }
  }, [isConnected, socket, isFocused]);

  // ✅ UPDATED GESTURE HANDLER
  const handleTap = useCallback(() => {
    if (isListening) {
      stopListening();
      return;
    }

    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);

    // 300ms window to catch double tap
    tapTimer.current = setTimeout(() => {
      const taps = tapCount.current;
      tapCount.current = 0;

      if (taps === 1) {
        // Single Tap -> Voice Command (Ask specific question)
        ttsQueue.current = [];
        isSpeaking.current = false;
        startListening();
      } else if (taps >= 2) {
        // Double Tap -> Immediate Scene Description
        ttsQueue.current = [];
        Tts.stop();
        isSpeaking.current = false;
        Vibration.vibrate([0, 50, 100, 50]); // Distinct Haptic for double tap
        Tts.speak("Analyzing scene.");
        captureAndDescribe();
      }
    }, 300);
  }, [isListening, startListening, stopListening, captureAndDescribe]);

  const isClear = lastAlert === "Clear";
  const isFastAlert = lastMessageFast && lastMessageType === "obstacle";
  const alertBoxStyle = [
    styles.alertBox,
    isFastAlert && styles.alertBoxUrgent,
    isClear && styles.alertBoxClear,
    lastMessageType === "description" && styles.alertBoxInfo,
    lastMessageType === "read_text" && styles.alertBoxRead,
  ];

  if (!device)
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Camera not found</Text>
      </View>
    );

  return (
    <Pressable style={styles.container} onPress={handleTap}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused}
        photo={true}
      />
      <View style={styles.overlay}>
        <Text style={styles.status}>
          {isConnected ? "🟢 Guardian Active" : "🔴 Reconnecting..."}
        </Text>
        {isListening ? (
          <View style={styles.listeningBox}>
            <Text style={styles.listeningText}>🎙️ Listening...</Text>
            <Text style={styles.listeningHint}>Speak your command</Text>
          </View>
        ) : (
          <View style={alertBoxStyle}>
            <Text
              style={[
                styles.alertText,
                isFastAlert && styles.alertTextUrgent,
                isClear && styles.alertTextClear,
              ]}
            >
              {lastAlert || "Scanning..."}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  error: { color: "white", textAlign: "center", marginTop: 50, fontSize: 16 },
  overlay: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    alignItems: "center",
    gap: 10,
  },
  status: {
    color: "white",
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 15,
    paddingVertical: 4,
    borderRadius: 20,
  },
  alertBox: {
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 15,
    width: "100%",
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  alertBoxUrgent: {
    borderColor: "#FF3B30",
    backgroundColor: "rgba(255,59,48,0.25)",
  },
  alertBoxClear: {
    borderColor: "#34C759",
    backgroundColor: "rgba(52,199,89,0.15)",
  },
  alertBoxInfo: {
    borderColor: "#34C759",
    backgroundColor: "rgba(52,199,89,0.1)",
  },
  alertBoxRead: {
    borderColor: "#007AFF",
    backgroundColor: "rgba(0,122,255,0.1)",
  },
  alertText: {
    color: "#FFD700",
    fontSize: 20,
    textAlign: "center",
    fontWeight: "bold",
  },
  alertTextUrgent: { color: "#FF3B30", fontSize: 22 },
  alertTextClear: { color: "#34C759" },
  listeningBox: {
    padding: 24,
    backgroundColor: "rgba(0,122,255,0.9)",
    borderRadius: 15,
    width: "100%",
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
  },
  listeningText: { color: "#fff", fontSize: 24, fontWeight: "bold" },
  listeningHint: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 6 },
});

export default CameraStream;