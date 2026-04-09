/**
 * useWakeWord.ts
 * Always-on "Hey Vision" wake word detection using Picovoice Porcupine.
 */

import { useEffect, useRef, useCallback } from "react";
import { PorcupineManager } from "@picovoice/porcupine-react-native";

const ACCESS_KEY = "zYBV1s7OTGoeeP2yXoM8vXdR6RXZ0ioAgu0tdpBJmFXWAjGUfGgeEw==";
const WAKE_WORD_MODEL = {
  keywordPath: "Hey-Vision_en_android_v4_0_0.ppn",
  label: "Hey Vision",
};

export const WakeWordController = {
  pause: async () => {},
  resume: async () => {},
};

export const useWakeWord = (
  onWakeWord: () => void,
  isPaused: boolean        
) => {
  const porcupineRef = useRef<PorcupineManager | null>(null);
  const isRunning = useRef(false);
  const isTransitioning = useRef(false);

  const bootPorcupine = useCallback(async () => {
    if (isRunning.current || isTransitioning.current || porcupineRef.current) return;
    isTransitioning.current = true;

    try {
      const manager = await PorcupineManager.fromKeywordPaths(
        ACCESS_KEY,
        [WAKE_WORD_MODEL.keywordPath],
        (keywordIndex: number) => {
          if (keywordIndex === 0) {
            console.log("🎯 Wake word detected: Hey Vision");
            onWakeWord();
          }
        },
        (error) => {
           if (!error.message.includes("-3")) {
              console.error("Porcupine error:", error.message);
           }
        }
      );

      porcupineRef.current = manager;
      await manager.start();
      isRunning.current = true;
      console.log("👂 Wake word listener active");

    } catch (e) {
      console.error("Failed to start Porcupine:", e);
    } finally {
      isTransitioning.current = false;
    }
  }, [onWakeWord]);

  const killPorcupine = useCallback(async () => {
    if (!porcupineRef.current || isTransitioning.current) return;
    isTransitioning.current = true;
    
    try {
      await porcupineRef.current.stop();
      await porcupineRef.current.delete(); 
    } catch (e) {
      // Ignore
    } finally {
      porcupineRef.current = null;
      isRunning.current = false;
      isTransitioning.current = false;
      console.log("⏸️ Wake word HARD paused and destroyed");
    }
  }, []);

  // ✅ Unified Effect: Handle all lifecycle and pause state changes here
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    // Bind controllers immediately
    WakeWordController.pause = async () => {
      await killPorcupine();
    };

    WakeWordController.resume = async () => {
      // 500ms safety buffer after expo-av releases
      timeoutId = setTimeout(() => {
        bootPorcupine();
      }, 500);
    };

    // React State logic
    if (isPaused) {
      killPorcupine();
    } else {
      bootPorcupine();
    }

    return () => {
      clearTimeout(timeoutId);
      killPorcupine();
    };
  }, [isPaused, bootPorcupine, killPorcupine]);
};