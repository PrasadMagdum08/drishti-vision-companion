/**
 * useVoice.ts
 * Voice recording with automatic silence detection.
 *
 * Flow:
 *   1. Wake word fires → startListening() called
 *   2. expo-av records audio
 *   3. Silence detector polls audio level every 300ms
 *   4. If silent for SILENCE_THRESHOLD_MS → auto-stops and sends
 *   5. Safety timeout: auto-stops after MAX_RECORDING_MS regardless
 *
 * Tap-to-stop is preserved as fallback (called from CameraStream).
 */

import { useState, useRef, useCallback } from "react";
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
    setIsListening(false);

    const currentRecording = recordingRef.current;
    recordingRef.current = null;

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
      // Stop TTS immediately when wake word fires
      Tts.stop();
      isStopping.current = false;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY,
        // Status update callback for silence detection
        (status) => {
          if (!status.isRecording) return;

          const elapsed = Date.now() - recordingStartTime.current;
          if (elapsed < MIN_RECORDING_MS) return;

          // Check metering level for silence
          const db = status.metering ?? -160;
          if (db < SILENCE_DB_THRESHOLD) {
            // Start silence timer if not already running
            if (!silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => {
                console.log("🔇 Silence detected — auto-sending");
                stopListening();
              }, SILENCE_THRESHOLD_MS);
            }
          } else {
            // Sound detected — reset silence timer
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        },
        SILENCE_POLL_MS  // poll interval in ms
      );

      recordingRef.current = recording;
      recordingStartTime.current = Date.now();
      setIsListening(true);
      console.log("🎙️ Recording started");

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