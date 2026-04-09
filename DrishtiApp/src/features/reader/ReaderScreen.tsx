import React, { useEffect, useRef, useCallback, useState } from "react";
import { StyleSheet, View, Text, Pressable, Vibration, Animated } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import { useIsFocused } from "@react-navigation/native"; 
import RNFS from "react-native-fs";
import Tts from "react-native-tts";
import { useStore, ReaderMode } from "../../core/store/useStore";
import { useVoice } from "../voice/useVoice";
import { useWakeWord } from "../voice/useWakeWord";

const AUTO_INTERVAL_MS = 2500; // Slightly increased to allow summary reading
const FRAME_QUALITY = 60; 

const ReaderScreen = () => {
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const isFocused = useIsFocused(); 

  const { isConnected, socket, lastAlert, lastMessageType, readerMode, setReaderMode } = useStore();
  const { isListening, startListening, stopListening } = useVoice();

  const [displayText, setDisplayText] = useState("Tap once to summarize. Double-tap for Auto Mode.");
  const [currentMode, setCurrentMode] = useState<ReaderMode>(null);
  const [isScanning, setIsScanning] = useState(false);

  const isSpeaking = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Gesture Trackers
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    if (!isFocused) {
      setIsScanning(false);
      Tts.stop();
      if (socket && isConnected) {
        socket.send(JSON.stringify({ type: "audio_command", action: "ignore_navigation" }));
      }
    }
  }, [isFocused, socket, isConnected]);

  useEffect(() => {
    if (isScanning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isScanning, pulseAnim]);

  const speak = useCallback((text: string) => {
    isSpeaking.current = true;
    Tts.stop();
    Tts.speak(text);
  }, []);

  useEffect(() => {
    const handler = () => { isSpeaking.current = false; };
    Tts.addEventListener("tts-finish", handler);
    return () => Tts.removeEventListener("tts-finish", handler);
  }, []);

  // Sync Global State
  useEffect(() => {
    if (readerMode !== currentMode) {
      setCurrentMode(readerMode);
      if (readerMode === "auto") {
        setDisplayText("Auto Mode: Panning...");
        speak("Auto mode started.");
      }
    }
  }, [readerMode, currentMode, speak]);

  const captureAndSend = useCallback(async (actionType: "continuous_summary" | "read_summary") => {
    if (!camera.current || !isConnected || !socket || !isFocused) return;
    try {
      setIsScanning(true);
      const photo = await camera.current.takeSnapshot({ quality: FRAME_QUALITY });
      if (photo?.path) {
        const base64 = await RNFS.readFile(photo.path, "base64");
        await RNFS.unlink(photo.path).catch(() => {});
        socket.send(JSON.stringify({ type: "audio_command", action: actionType, frame: base64 }));
      }
    } catch (e) {
      console.error("Capture error:", e);
    } finally {
      setIsScanning(false);
    }
  }, [isConnected, socket, isFocused]);

  // Main Auto-Reading Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (currentMode === "auto" && isConnected && isFocused) {
      interval = setInterval(() => {
        if (!isSpeaking.current && !isListening) captureAndSend("continuous_summary");
      }, AUTO_INTERVAL_MS);
    }
    return () => clearInterval(interval);
  }, [currentMode, isConnected, isFocused, isListening, captureAndSend]);

  // Intercept backend text
  useEffect(() => {
    if (!isFocused) return;

    if (lastMessageType === "nav_command") {
      const text = lastAlert?.toLowerCase() || "";
      if (text.includes("stop") || text.includes("guardian") || text.includes("go back")) {
        setCurrentMode(null);
        setReaderMode(null);
        Tts.stop();
        setDisplayText("Stopping reader...");
        return;
      }
      if (text.includes("auto mode")) {
        setCurrentMode("auto");
        setReaderMode("auto");
        return;
      }
    }

    if (lastMessageType === "ocr_result" || lastMessageType === "description") {
      setDisplayText(lastAlert);
      speak(lastAlert);
    }
  }, [lastAlert, lastMessageType, speak, isFocused, setReaderMode]);

  const handleWakeWord = useCallback(() => {
    if (isListening || !isFocused) return;
    startListening();
  }, [isListening, isFocused, startListening]);

  useWakeWord(handleWakeWord, false);

  // ✅ NEW: Intuitive Gesture Logic
  const handleTap = useCallback(() => {
    if (isListening) { stopListening(); return; }
    
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);

    tapTimer.current = setTimeout(() => {
      const taps = tapCount.current;
      tapCount.current = 0;

      if (taps === 1) {
        // Single Tap -> Context Summary Snapshot
        if (currentMode === "auto") {
           setCurrentMode(null);
           setReaderMode(null);
           setDisplayText("Auto mode stopped.");
           speak("Stopped.");
        } else {
           Vibration.vibrate(50);
           setDisplayText("Capturing for summary...");
           speak("Capturing.");
           captureAndSend("read_summary");
        }
      } else if (taps >= 2) {
        // Double Tap -> Toggle Auto Mode
        if (currentMode === "auto") {
           setCurrentMode(null);
           setReaderMode(null);
           setDisplayText("Auto mode stopped.");
           speak("Stopped.");
        } else {
           setCurrentMode("auto");
           setReaderMode("auto");
           Vibration.vibrate([0, 50, 100, 50]);
           setDisplayText("Auto Mode: Panning...");
           speak("Auto mode started.");
        }
      }
    }, 300); // 300ms window to catch double taps
  }, [isListening, stopListening, currentMode, captureAndSend, speak, setReaderMode]);

  if (!device) return <View style={styles.container}><Text style={styles.errorText}>No Camera</Text></View>;

  return (
    <Pressable style={styles.container} onPress={handleTap}>
      <Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive={isFocused} photo={true} />
      <View style={styles.overlay} />
      <View style={styles.topBar}>
        <Text style={styles.moduleTagText}>📖 READER</Text>
        <Text>{isConnected ? "🟢" : "🔴"}</Text>
      </View>
      {isScanning && (
        <View style={styles.scanningContainer}>
          <Animated.View style={[styles.scanPulse, { transform: [{ scale: pulseAnim }] }]} />
        </View>
      )}
      <View style={styles.bottomCard}>
        <Text style={styles.resultText} numberOfLines={6}>{displayText}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  errorText: { color: "#fff", textAlign: "center", marginTop: 50 },
  topBar: { position: "absolute", top: 52, left: 16, right: 16, flexDirection: "row", justifyContent: "space-between" },
  moduleTagText: { color: "#fff", fontWeight: "700", backgroundColor: "rgba(0,122,255,0.85)", padding: 8, borderRadius: 10 },
  scanningContainer: { position: "absolute", top: "40%", alignSelf: "center" },
  scanPulse: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: "#007AFF" },
  bottomCard: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.88)", padding: 20, borderTopLeftRadius: 24 },
  resultText: { color: "#FFF", fontSize: 20, fontWeight: "600", lineHeight: 30 },
});

export default ReaderScreen;