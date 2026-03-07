/**
 * CameraStream.tsx — Guardian v2
 *
 * Changes:
 * - 8 FPS frame capture (125ms interval vs 500ms before)
 * - Fast alerts spoken at higher TTS rate for urgency
 * - "Fast bike, right" displayed in red with urgent styling
 * - "Clear" displayed in green
 * - TTS queue: voice responses always skip to front
 * - Critical vehicles (<= 1m) interrupt immediately
 * - Tap preserved as fallback alongside wake word
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Vibration,
} from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import RNFS from "react-native-fs";
import Tts from "react-native-tts";
import { useStore } from "../../core/store/useStore";
import { useVoice } from "../voice/useVoice";
import { useWakeWord } from "../voice/useWakeWord";

// ─── Constants ────────────────────────────────────────────────────────────────
const FRAME_INTERVAL_MS = 125;        // 8 FPS — catches fast-moving objects
const FRAME_QUALITY = 35;             // lower quality = faster encode/send
const TRIPLE_TAP_WINDOW_MS = 800;
const SOS_VIBRATION = [0, 200, 100, 200, 100, 600];

// TTS rates
const TTS_RATE_NORMAL = 0.52;
const TTS_RATE_FAST = 0.62;           // faster speech for "Fast X" alerts

// Critical: vehicle at closest distance bucket — interrupt immediately
const CRITICAL_PREFIXES = ["fast car", "fast motorcycle", "fast bus", "fast truck"];
const CRITICAL_DISTANCE = "0.5 meters";

// ─── Component ────────────────────────────────────────────────────────────────
const CameraStream = () => {
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const {
    isConnected,
    connect,
    sendFrame,
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

  // ─── TTS Queue ──────────────────────────────────────────────────────────────
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

    // Speak fast alerts faster so user can react quicker
    Tts.setDefaultRate(next.fast ? TTS_RATE_FAST : TTS_RATE_NORMAL);
    Tts.speak(next.text);
  }, []);

  const enqueueAlert = useCallback(
    (alert: string, priority: boolean, messageType: string, fast: boolean) => {
      const alertLower = alert.toLowerCase();

      // Tier 1: Critical approaching vehicle at 0.5m — interrupt everything
      const isCritical =
        CRITICAL_PREFIXES.some((p) => alertLower.startsWith(p)) ||
        (alertLower.includes("0.5 meters") &&
          ["car", "motorcycle", "bus", "truck"].some((v) => alertLower.includes(v)));

      if (isCritical) {
        ttsQueue.current = [{ text: alert, fast: true }];
        Tts.stop();
        isSpeaking.current = false;
        speakNext();
        return;
      }

      // Tier 2: Voice response — skip obstacle queue, go to front
      if (priority || messageType === "description" || messageType === "read_text") {
        ttsQueue.current = [{ text: alert, fast: false }];
        if (!isSpeaking.current) speakNext();
        return;
      }

      // Tier 3: Normal obstacle alert — queue, cap at 4
      // Higher cap than before because alerts are more compressed and faster
      if (ttsQueue.current.length >= 4) {
        // Keep only the most recent 3 — drop oldest stale alerts
        ttsQueue.current = ttsQueue.current.slice(-3);
      }
      ttsQueue.current.push({ text: alert, fast });

      if (!isSpeaking.current) speakNext();
    },
    [speakNext]
  );

  // ─── Wake Word Handler ────────────────────────────────────────────────────
  const handleWakeWord = useCallback(() => {
    if (isListening) return;
    ttsQueue.current = [];
    Tts.stop();
    isSpeaking.current = false;
    Vibration.vibrate(80);
    Tts.speak("Listening.");
    setTimeout(() => startListening(), 400);
  }, [isListening, startListening]);

  useWakeWord(handleWakeWord, isSpeakingState);

  // ─── TTS Setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    Tts.setDefaultLanguage("en-IN");
    Tts.setDefaultRate(TTS_RATE_NORMAL);

    Tts.getInitStatus()
      .then(() => {
        console.log("🟢 TTS Ready");
        Tts.speak("Drishti online. Say Hey Vision to speak.");
      })
      .catch((err) => console.error("🔴 TTS Failed:", err));

    Tts.addEventListener("tts-finish", () => {
      isSpeaking.current = false;
      isTtsSpeaking.current = false;
      setIsSpeakingState(false);
      speakNext();
    });

    return () => {
      Tts.removeEventListener("tts-finish", () => {});
    };
  }, [speakNext]);

  // ─── WebSocket ───────────────────────────────────────────────────────────
  useEffect(() => {
    connect();
  }, [connect]);

  // ─── Route Server Responses ───────────────────────────────────────────────
  useEffect(() => {
    if (!lastAlert || isListening) return;
    enqueueAlert(
      lastAlert,
      lastMessagePriority ?? false,
      lastMessageType ?? "",
      lastMessageFast ?? false
    );
  }, [lastAlert, lastMessageType, lastMessagePriority, lastMessageFast, isListening, enqueueAlert]);

  // ─── Camera Frame Loop — 8 FPS ───────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || isListening) return;
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
        // Silent skip — occasional frame drops expected at 8 FPS
      } finally {
        isProcessing = false;
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isConnected, isListening, sendFrame]);

  // ─── Tap Handler ─────────────────────────────────────────────────────────
  const handleTap = useCallback(() => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);

    tapTimer.current = setTimeout(() => {
      const taps = tapCount.current;
      tapCount.current = 0;

      if (taps >= 3) {
        console.log("🆘 SOS");
        Vibration.vibrate(SOS_VIBRATION);
        ttsQueue.current = [];
        Tts.stop();
        isSpeaking.current = false;
        Tts.speak("Emergency SOS activated. Contacting emergency contacts.");
        sendRaw(JSON.stringify({ type: "sos_trigger" }));
      } else {
        Vibration.vibrate(50);
        if (isListening) {
          stopListening();
        } else {
          ttsQueue.current = [];
          Tts.stop();
          isSpeaking.current = false;
          startListening();
        }
      }
    }, TRIPLE_TAP_WINDOW_MS);
  }, [isListening, startListening, stopListening, sendRaw]);

  // ─── Alert Box Styling ───────────────────────────────────────────────────
  // Fast alerts → red urgent box
  // Clear → green box
  // Voice responses → teal box
  // Normal obstacles → default gold box
  const isClear = lastAlert === "Clear";
  const isFastAlert = lastMessageFast && lastMessageType === "obstacle";

  const alertBoxStyle = [
    styles.alertBox,
    isFastAlert && styles.alertBoxUrgent,
    isClear && styles.alertBoxClear,
    lastMessageType === "description" && styles.alertBoxInfo,
    lastMessageType === "read_text" && styles.alertBoxRead,
  ];

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Camera not found</Text>
      </View>
    );
  }

  return (
    <Pressable style={styles.container} onPress={handleTap}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
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
            <Text style={[
              styles.alertText,
              isFastAlert && styles.alertTextUrgent,
              isClear && styles.alertTextClear,
            ]}>
              {lastAlert || "Scanning..."}
            </Text>
          </View>
        )}

        <Text style={styles.hint}>Say "Hey Vision" to ask  •  Triple-tap SOS</Text>
      </View>
    </Pressable>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────
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
  alertTextUrgent: {
    color: "#FF3B30",
    fontSize: 22,
  },
  alertTextClear: {
    color: "#34C759",
  },
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
  hint: { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 4 },
});

export default CameraStream;