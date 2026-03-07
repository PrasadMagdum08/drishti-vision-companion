import { create } from "zustand";

interface DrishtiState {
  socket: WebSocket | null;
  isConnected: boolean;
  lastAlert: string;
  lastMessageType: string;
  lastMessagePriority: boolean;
  lastMessageFast: boolean;
  connect: () => void;
  sendFrame: (base64Frame: string) => void;
  sendRaw: (message: string) => void;
}

const WS_URL = "ws://192.168.16.125:8000/ws/vision/stream/";
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 15000;
const MAX_ATTEMPTS = 10;

export const useStore = create<DrishtiState>((set, get) => ({
  socket: null,
  isConnected: false,
  lastAlert: "",
  lastMessageType: "",
  lastMessagePriority: false,
  lastMessageFast: false,

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

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const messageText = data.text || data.alert || "";
          const messageType = data.type || "";
          const messagePriority = data.priority === true;
          const messageFast = data.fast === true;
          if (messageText) {
            set({
              lastAlert: messageText,
              lastMessageType: messageType,
              lastMessagePriority: messagePriority,
              lastMessageFast: messageFast,
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

  sendRaw: (message: string) => {
    const { socket, isConnected } = get();
    if (!socket || !isConnected) return;
    socket.send(message);
  },
}));