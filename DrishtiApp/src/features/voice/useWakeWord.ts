/**
 * useWakeWord.ts
 * Always-on "Hey Vision" wake word detection using Picovoice Porcupine.
 *
 * Lifecycle:
 *   1. App opens → Porcupine starts listening in background
 *   2. User says "Hey Vision" → onWakeWord() fires
 *   3. Caller starts recording, plays beep
 *   4. Silence detected → recording stops, audio sent
 *   5. Porcupine resumes listening automatically
 *
 * The listener pauses while Drishti is speaking (isSpeaking=true)
 * to prevent TTS audio from accidentally triggering the wake word.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  PorcupineManager,
  BuiltInKeywords,
} from "@picovoice/porcupine-react-native";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const ACCESS_KEY = "zYBV1s7OTGoeeP2yXoM8vXdR6RXZ0ioAgu0tdpBJmFXWAjGUfGgeEw==";

// .ppn file placed in android/app/src/main/assets/
const WAKE_WORD_MODEL = {
  keywordPath: "Hey-Vision_en_android_v4_0_0.ppn",
  label: "Hey Vision",
};

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export const useWakeWord = (
  onWakeWord: () => void,
  isPaused: boolean        // pass true while Drishti TTS is speaking
) => {
  const porcupineRef = useRef<PorcupineManager | null>(null);
  const isRunning = useRef(false);

  const startListening = useCallback(async () => {
    if (isRunning.current || porcupineRef.current) return;
    try {
      const manager = await PorcupineManager.fromKeywordPaths(
        ACCESS_KEY,
        [WAKE_WORD_MODEL.keywordPath],
        // Detection callback — fires on "Hey Vision"
        (keywordIndex: number) => {
          if (keywordIndex === 0) {
            console.log("🎯 Wake word detected: Hey Vision");
            onWakeWord();
          }
        },
        // Error callback
        (error) => {
          console.error("Porcupine error:", error.message);
        }
      );
      await manager.start();
      porcupineRef.current = manager;
      isRunning.current = true;
      console.log("👂 Wake word listener active");
    } catch (e) {
      console.error("Failed to start Porcupine:", e);
    }
  }, [onWakeWord]);

  const stopListening = useCallback(async () => {
    if (!porcupineRef.current) return;
    try {
      await porcupineRef.current.stop();
      await porcupineRef.current.delete();
      porcupineRef.current = null;
      isRunning.current = false;
      console.log("🔇 Wake word listener stopped");
    } catch (e) {
      console.error("Failed to stop Porcupine:", e);
    }
  }, []);

  // Start on mount, stop on unmount
  useEffect(() => {
    startListening();
    return () => {
      stopListening();
    };
  }, []);

  // Pause while Drishti is speaking — prevents TTS from triggering wake word
  useEffect(() => {
    if (isPaused) {
      porcupineRef.current?.stop().catch(() => {});
      isRunning.current = false;
      console.log("⏸️ Wake word paused (TTS speaking)");
    } else {
      if (porcupineRef.current && !isRunning.current) {
        porcupineRef.current.start().catch(() => {});
        isRunning.current = true;
        console.log("▶️ Wake word resumed");
      }
    }
  }, [isPaused]);
};