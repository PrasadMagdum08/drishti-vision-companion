// ============================================================
// Drishti — Central Config
// Update MACHINE_IP when your dev machine IP changes.
// Phone and PC must be on the same WiFi network.
// ============================================================

const MACHINE_IP = "192.168.16.125";

export const WS_URL = `ws://${MACHINE_IP}:8000/ws/vision/stream/`;
export const API_URL = `http://${MACHINE_IP}:8000/api`;