import { create } from "zustand";
import { WS_URL } from "../../config";

export type ReaderMode = "auto" | "manual" | null;

interface DrishtiState {
  socket: WebSocket | null;
  isConnected: boolean;
  lastAlert: string;
  lastMessageType: string | null;
  lastMessagePriority: boolean | null;
  lastMessageFast: boolean | null;

  // ✅ New Reader State
  readerMode: ReaderMode;
  setReaderMode: (mode: ReaderMode) => void;

  connect: () => void;
  sendFrame: (base64Frame: string) => void;
  sendRaw: (jsonString: string) => void;
}

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 15000;
const MAX_ATTEMPTS = 10;

export const useStore = create<DrishtiState>((set, get) => ({
  socket: null,
  isConnected: false,
  lastAlert: "",
  lastMessageType: null,
  lastMessagePriority: null,
  lastMessageFast: null,
  readerMode: null,

  setReaderMode: (mode) => set({ readerMode: mode }),

  connect: () => {
    let attempt = 0;
    let delay = BASE_DELAY_MS;

    const tryConnect = () => {
      if (attempt >= MAX_ATTEMPTS) {
        console.log("❌ Max reconnect attempts reached");
        return;
      }
      attempt += 1;
      console.log(`🔌 Connecting (attempt ${attempt})`);
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("✅ Connected");
        attempt = 0;
        delay = BASE_DELAY_MS;
        set({ isConnected: true, socket: ws });
      };

      ws.onclose = (e) => {
        console.warn(`🔴 Closed (code: ${e.code})`);
        set({ isConnected: false, socket: null });
        delay = Math.min(delay * 1.5, MAX_DELAY_MS);
        setTimeout(tryConnect, delay);
      };

      ws.onerror = (e) => console.error("❌ Error:", e);

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          const msgType = data.type;

          // ✅ Intercept Nav Commands
          if (msgType === "nav_command" && data.text) {
            const navHandler = (globalThis as any).__drishtiNavHandler;
            if (navHandler) {
              const handled = await navHandler(data.text);
              if (handled) return; 
            }
            // If not a nav command, fall through as a description
            set({
              lastAlert: data.text,
              lastMessageType: "description",
              lastMessagePriority: false,
              lastMessageFast: false,
            });
            return;
          }

          const messageToSpeak = data.text || data.alert || "";
          if (messageToSpeak) {
            set({
              lastAlert: messageToSpeak,
              lastMessageType: msgType,
              lastMessagePriority: data.priority ?? false,
              lastMessageFast: data.fast ?? false,
            });
          }
        } catch (e) {
          console.error("Parse error:", e);
        }
      };

      set({ socket: ws });
    };

    tryConnect();
  },

  sendFrame: (payload: string) => {
    const { socket, isConnected } = get();
    if (!socket || !isConnected || !payload) return;
    socket.send(JSON.stringify({ type: "video_frame", data: payload }));
  },

  sendRaw: (jsonString: string) => {
    const { socket, isConnected } = get();
    if (!socket || !isConnected) return;
    socket.send(jsonString);
  },
}));