import { useCallback, useRef } from "react";
import Tts from "react-native-tts";
import { useStore } from "../store/useStore";

type NavigationTarget = "Home" | "Camera" | "Reader" | "Debug";

const NAV_READER   = ["reader", "read mode", "reading mode", "switch to read", "open reader"];
const NAV_GUARDIAN = ["guardian", "guardian mode", "switch to guardian", "open guardian", "camera mode", "obstacle"];
const NAV_HOME     = ["go home", "open home", "home screen", "main menu"];
const MODE_AUTO    = ["auto mode", "automatic mode", "auto read", "scan mode"];
const MODE_MANUAL  = ["manual mode", "voice mode", "deep read"];
const CMD_STOP     = ["stop", "shut up", "quiet", "pause", "halt"];

interface Props {
  currentRoute: string;
  navigate: (screen: NavigationTarget) => void;
}

export const useVoiceNavigator = ({ currentRoute, navigate }: Props) => {
  const navCooldown = useRef(false);

  const handleNavAudio = useCallback(
    async (transcribedText: string): Promise<boolean> => {
      if (navCooldown.current) return false;
      const t = transcribedText.toLowerCase().trim();

      // ✅ 1. THE GLOBAL STOP COMMAND
      if (CMD_STOP.some((w) => t.includes(w))) {
        Tts.stop(); // Instantly kill any ongoing speech
        useStore.getState().setReaderMode(null); // Reset reader state if active
        console.log("🛑 Global Stop Triggered");
        return true;
      }

      // ✅ 2. NAVIGATION
      if (NAV_READER.some((w) => t.includes(w))) {
        if (currentRoute === "Reader") {
          Tts.speak("Already in Reader mode.");
          return true;
        }
        navCooldown.current = true;
        Tts.speak("Opening Reader.");
        setTimeout(() => { navigate("Reader"); navCooldown.current = false; }, 900);
        return true;
      }

      if (NAV_GUARDIAN.some((w) => t.includes(w))) {
        if (currentRoute === "Camera") {
          Tts.speak("Already in Guardian mode.");
          return true;
        }
        navCooldown.current = true;
        Tts.speak("Switching to Guardian.");
        setTimeout(() => { navigate("Camera"); navCooldown.current = false; }, 900);
        return true;
      }

      if (NAV_HOME.some((w) => t.includes(w))) {
        if (currentRoute === "Home") {
          Tts.speak("Already on home screen.");
          return true;
        }
        navCooldown.current = true;
        Tts.speak("Going home.");
        setTimeout(() => { navigate("Home"); navCooldown.current = false; }, 900);
        return true;
      }

      // ✅ 3. READER MODES
      if (MODE_AUTO.some((w) => t.includes(w))) {
        useStore.getState().setReaderMode("auto");
        Tts.speak("Continuous auto mode active. Panning camera.");
        return true;
      }

      if (MODE_MANUAL.some((w) => t.includes(w))) {
        useStore.getState().setReaderMode("manual");
        Tts.speak("Manual mode. Say read this when ready.");
        return true;
      }

      return false;
    },
    [currentRoute, navigate]
  );

  return { handleNavAudio };
};