import { useState, useRef, useCallback } from "react";
import { Vibration } from "react-native"; // ✅ IMPORT ADDED
import { Audio } from "expo-av";
import RNFS from "react-native-fs";
import Tts from "react-native-tts";
import { useStore } from "../../core/store/useStore";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD_MS = 1800;   // stop after 1.8s of silence
const SILENCE_POLL_MS = 300;         // check audio level every 300ms
const MIN_RECORDING_MS = 1000;       // don't stop before 1s (catches short commands)
const MAX_RECORDING_MS = 10000;      // hard stop at 10s

// Audio level below this = silence (-50dB is a reasonable threshold)
const SILENCE_DB_THRESHOLD = -40;

// ─── HELPER: STRICT TTS SEQUENCER ─────────────────────────────────────────────
const speakAndWait = (text: string): Promise<void> => {
  return new Promise((resolve) => {
    Tts.stop(); // Instantly kill any ongoing Guardian/Reader speech

    let isResolved = false;
    const finish = () => {
      if (isResolved) return;
      isResolved = true;
      Tts.removeEventListener("tts-finish", finish);
      Tts.removeEventListener("tts-cancel", finish);
      Tts.removeEventListener("tts-error", finish);
      resolve();
    };

    // Listen for the end of the TTS phrase
    Tts.addEventListener("tts-finish", finish);
    Tts.addEventListener("tts-cancel", finish);
    Tts.addEventListener("tts-error", finish);

    Tts.speak(text);

    // Failsafe: Force resolve after 2.5s if TTS engine hangs
    setTimeout(finish, 2500); 
  });
};

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export const useVoice = () => {
  const [isListening, setIsListening] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTime = useRef<number>(0);
  const isStopping = useRef(false);

  const _clearTimers = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
    pollIntervalRef.current = null;
  }, []);

  const _sendAudio = useCallback(async (recording: Audio.Recording) => {
    try {
      const uri = recording.getURI();
      if (!uri) return;

      const base64Audio = await RNFS.readFile(
        uri.replace("file://", ""),
        "base64"
      );

      const audioMessage = JSON.stringify({
        type: "audio_command",
        data: base64Audio,
      });

      const { socket } = useStore.getState();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(audioMessage);
        console.log("📤 Audio packet sent");
      } else {
        console.error("❌ Socket not open — audio dropped");
      }

      await RNFS.unlink(uri.replace("file://", "")).catch(() => {});
    } catch (e) {
      console.error("Send audio error:", e);
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (isStopping.current || !recordingRef.current) return;
    isStopping.current = true;

    _clearTimers();
    
    // ✅ 1. IMMEDIATE AUDIO CUE: "Processing" + Double Vibration
    Vibration.vibrate([0, 50, 100, 50]); 
    Tts.speak("Processing.");

    const currentRecording = recordingRef.current;
    recordingRef.current = null;
    setIsListening(false);

    try {
      await currentRecording.stopAndUnloadAsync();
      await _sendAudio(currentRecording);
    } catch (e) {
      console.error("Stop recording error:", e);
    } finally {
      isStopping.current = false;
    }
  }, [_clearTimers, _sendAudio]);

  const startListening = useCallback(async () => {
    if (isListening || recordingRef.current) return;

    try {
      setIsListening(true); // Tell UI we are starting
      isStopping.current = false;

      // ✅ 1. STRICT SEQUENTIAL LOCK: Wait for TTS to finish speaking
      await speakAndWait("Speak now.");

      // ✅ 2. HAPTIC CUE: Sharp buzz physically confirms mic is hot
      Vibration.vibrate(80);

      // 3. Start hardware recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY,
        (status) => {
          if (!status.isRecording) return;

          const elapsed = Date.now() - recordingStartTime.current;
          if (elapsed < MIN_RECORDING_MS) return;

          const db = status.metering ?? -160;
          if (db < SILENCE_DB_THRESHOLD) {
            if (!silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => {
                console.log("🔇 Silence detected — auto-sending");
                stopListening();
              }, SILENCE_THRESHOLD_MS);
            }
          } else {
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        },
        SILENCE_POLL_MS  
      );

      recordingRef.current = recording;
      recordingStartTime.current = Date.now();
      console.log("🎙️ Recording started (Strict Lock Released)");

      // Safety: hard stop at MAX_RECORDING_MS
      maxTimerRef.current = setTimeout(() => {
        console.log("⏱️ Max recording time reached — auto-sending");
        stopListening();
      }, MAX_RECORDING_MS);

    } catch (e) {
      console.error("Start recording error:", e);
      setIsListening(false);
      recordingRef.current = null;
      isStopping.current = false;
    }
  }, [isListening, stopListening]);

  return { isListening, startListening, stopListening };
};