import { useState, useRef, useCallback } from "react";
import { Vibration } from "react-native";
import { Audio } from "expo-av";
import RNFS from "react-native-fs";
import Tts from "react-native-tts";
import { useStore } from "../../core/store/useStore";
import { WakeWordController } from "./useWakeWord";

const SILENCE_THRESHOLD_MS = 1800;   
const SILENCE_POLL_MS = 300;         
const MIN_RECORDING_MS = 1000;       
const MAX_RECORDING_MS = 10000;      
const SILENCE_DB_THRESHOLD = -40;

const speakAndWait = (text: string): Promise<void> => {
  return new Promise((resolve) => {
    Tts.stop(); 
    let isResolved = false;
    const finish = () => {
      if (isResolved) return;
      isResolved = true;
      Tts.removeEventListener("tts-finish", finish);
      Tts.removeEventListener("tts-cancel", finish);
      Tts.removeEventListener("tts-error", finish);
      resolve();
    };

    Tts.addEventListener("tts-finish", finish);
    Tts.addEventListener("tts-cancel", finish);
    Tts.addEventListener("tts-error", finish);

    Tts.speak(text);
    setTimeout(finish, 2500); 
  });
};

export const useVoice = () => {
  const [isListening, setIsListening] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartTime = useRef<number>(0);
  const isStopping = useRef(false);

  const _clearTimers = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
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
    
    Vibration.vibrate([0, 50, 100, 50]); 
    Tts.speak("Processing.");

    const currentRecording = recordingRef.current;
    recordingRef.current = null;
    setIsListening(false);

    try {
      await currentRecording.stopAndUnloadAsync();
      await _sendAudio(currentRecording);
      
      // ✅ Release Expo's grip on the audio system
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

    } catch (e) {
      console.error("Stop recording error:", e);
    } finally {
      isStopping.current = false;
      // ✅ Trigger resume controller (which has a built-in 500ms delay)
      WakeWordController.resume();
    }
  }, [_clearTimers, _sendAudio]);

  const startListening = useCallback(async () => {
    if (isListening || recordingRef.current) return;

    try {
      setIsListening(true); 
      isStopping.current = false;

      // ✅ 1. Kill Porcupine immediately
      await WakeWordController.pause();

      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
          console.error("Microphone permission denied");
          setIsListening(false);
          WakeWordController.resume();
          return;
      }

      await speakAndWait("Speak now.");
      
      // ✅ 2. Hardware buffer before Expo claims the mic
      await new Promise(resolve => setTimeout(resolve, 400));
      
      Vibration.vibrate(80);

      // ✅ 3. Claim audio focus smoothly
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
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
      console.log("🎙️ Recording started");

      maxTimerRef.current = setTimeout(() => {
        console.log("⏱️ Max recording time reached");
        stopListening();
      }, MAX_RECORDING_MS);

    } catch (e) {
      console.error("Start recording error:", e);
      setIsListening(false);
      recordingRef.current = null;
      isStopping.current = false;
      WakeWordController.resume(); 
    }
  }, [isListening, stopListening]);

  return { isListening, startListening, stopListening };
};