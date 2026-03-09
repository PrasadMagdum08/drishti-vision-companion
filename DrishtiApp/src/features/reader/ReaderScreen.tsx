import React, { useEffect, useRef, useCallback, useState } from "react";
import { StyleSheet, View, Text, Pressable, Vibration, Animated } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import { useIsFocused } from "@react-navigation/native"; 
import RNFS from "react-native-fs";
import Tts from "react-native-tts";
import { useStore, ReaderMode } from "../../core/store/useStore";
import { useVoice } from "../voice/useVoice";
import { useWakeWord } from "../voice/useWakeWord";

const AUTO_INTERVAL_MS = 2000; 
const MANUAL_HEARTBEAT_MS = 1000; 
const FRAME_QUALITY = 60; 

const ReaderScreen = () => {
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const isFocused = useIsFocused(); 

  const { isConnected, socket, lastAlert, lastMessageType, readerMode, setReaderMode, sendFrame } = useStore();
  const { isListening, startListening, stopListening } = useVoice();

  const [displayText, setDisplayText] = useState("Initializing Reader...");
  const [currentMode, setCurrentMode] = useState<ReaderMode>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSpeakingState, setIsSpeakingState] = useState(false);

  const isSpeaking = useRef(false);
  const modePromptDone = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Cleanup: Stop all processes when leaving the screen
  useEffect(() => {
    if (!isFocused) {
      setIsScanning(false);
      Tts.stop();
      // Inform backend to ignore any remaining pending OCR tasks
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
    setIsSpeakingState(true);
    Tts.stop();
    Tts.speak(text);
  }, []);

  useEffect(() => {
    const handler = () => {
      isSpeaking.current = false;
      setIsSpeakingState(false);
      
      const alert = useStore.getState().lastAlert;
      if (alert && (alert.includes("summarize it?") || alert.includes("read on your command."))) {
        startListening();
      }
    };
    Tts.addEventListener("tts-finish", handler);
    return () => Tts.removeEventListener("tts-finish", handler);
  }, [startListening]);

  useEffect(() => {
    if (!modePromptDone.current) {
      modePromptDone.current = true;
      setReaderMode(null);
      setTimeout(() => {
        setDisplayText("Which mode do you want?");
        speak("Reader mode. Say auto mode to read continuously, or manual mode to read on your command.");
      }, 600);
    }
  }, [setReaderMode, speak]);

  useEffect(() => {
    if (readerMode && readerMode !== currentMode) {
      setCurrentMode(readerMode);
      if (readerMode === "auto") {
        setDisplayText("Auto Mode: Panning...");
      } else {
        setDisplayText("Manual Mode: Say 'read this'");
      }
    }
  }, [readerMode, currentMode]);

  const captureAndSend = useCallback(async (actionType: "continuous_read" | "read_text") => {
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
        if (!isSpeaking.current && !isListening) captureAndSend("continuous_read");
      }, AUTO_INTERVAL_MS);
    }
    return () => clearInterval(interval);
  }, [currentMode, isConnected, isFocused, isListening, captureAndSend]);

  // Manual Mode Heartbeat (Background buffer keep-alive)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isFocused && isConnected && currentMode === "manual" && !isListening) {
      let isProcessing = false;
      interval = setInterval(async () => {
        if (!camera.current || isProcessing || !isFocused) return;
        isProcessing = true;
        try {
          const photo = await camera.current.takeSnapshot({ quality: 30 }); 
          if (photo?.path) {
            const base64 = await RNFS.readFile(photo.path, "base64");
            sendFrame(base64); 
            await RNFS.unlink(photo.path).catch(() => {});
          }
        } catch (e) {
        } finally {
          isProcessing = false;
        }
      }, MANUAL_HEARTBEAT_MS); 
    }
    return () => clearInterval(interval);
  }, [isFocused, isConnected, currentMode, isListening, sendFrame]);

  // Handle incoming messages and navigation interrupts
  useEffect(() => {
    if (!isFocused) return;

    if (lastMessageType === "nav_command") {
      const text = lastAlert?.toLowerCase() || "";
      // If we are navigating away, kill the mode instantly
      if (text.includes("stop") || text.includes("manual") || text.includes("guardian") || text.includes("go back")) {
        setCurrentMode("manual");
        setReaderMode("manual");
        Tts.stop();
        setDisplayText("Stopping reader...");
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
    
    if (currentMode === "auto") {
      Vibration.vibrate(80);
      speak("Scanning.");
      setTimeout(() => captureAndSend("continuous_read"), 600);
    } else {
      startListening();
    }
  }, [isListening, currentMode, isFocused, startListening, captureAndSend, speak]);

  useWakeWord(handleWakeWord, isSpeakingState);

  const handleTap = useCallback(() => {
    if (isListening) { stopListening(); return; }
    
    if (currentMode === "auto") {
      Vibration.vibrate(80);
      speak("Scanning.");
      setTimeout(() => captureAndSend("continuous_read"), 600);
    } else {
      startListening();
    }
  }, [isListening, currentMode, startListening, captureAndSend, stopListening, speak]);

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