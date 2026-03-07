/**
 * DebugScreen.tsx — Guardian Debug View
 *
 * Shows live annotated camera frames with:
 * - Bounding boxes colored by tier (red=vehicle, orange=person, yellow=object)
 * - Labels with distance and confidence
 * - "FAST" badge on approaching objects
 * - Sector lines (left/center/right boundaries)
 * - Stats panel: FPS, object count, active tracks, latency
 *
 * Activated from HomeScreen → "Debug Vision" button.
 * Sends video frames with debug:true flag so backend annotates and returns them.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  SafeAreaView,
} from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import RNFS from "react-native-fs";
import { useNavigation } from "@react-navigation/native";
import { useStore } from "../../core/store/useStore";

// ─── Constants ────────────────────────────────────────────────────────────────
const FRAME_INTERVAL_MS = 200;   // 5 FPS for debug (annotated frames are larger)
const FRAME_QUALITY = 50;

// ─── Types ────────────────────────────────────────────────────────────────────
interface DetectionLog {
  id: string;
  label: string;
  sector: string;
  dist: string;
  fast: boolean;
  priority: number;
  timestamp: number;
}

interface DebugStats {
  fps: number;
  objectCount: number;
  trackCount: number;
  latencyMs: number;
  lastAlert: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
const DebugScreen = () => {
  const navigation = useNavigation();
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const { isConnected, connect, socket } = useStore();

  const [annotatedFrame, setAnnotatedFrame] = useState<string | null>(null);
  const [detectionLog, setDetectionLog] = useState<DetectionLog[]>([]);
  const [stats, setStats] = useState<DebugStats>({
    fps: 0,
    objectCount: 0,
    trackCount: 0,
    latencyMs: 0,
    lastAlert: "—",
  });

  // FPS tracking
  const frameTimestamps = useRef<number[]>([]);
  const frameSendTime = useRef<number>(0);

  // ─── WebSocket Debug Listener ──────────────────────────────────────────────
  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "debug_frame") {
          // Annotated frame from backend
          const latency = Date.now() - frameSendTime.current;
          setAnnotatedFrame(`data:image/jpeg;base64,${data.frame}`);

          // Update detection log
          const detections: DetectionLog[] = (data.detections || []).map(
            (d: any, i: number) => ({
              id: `${d.label}-${i}-${Date.now()}`,
              label: d.label,
              sector: d.sector,
              dist: d.dist_str,
              fast: d.is_fast,
              priority: d.priority,
              timestamp: Date.now(),
            })
          );

          setDetectionLog(detections);
          setStats({
            fps: data.fps || 0,
            objectCount: detections.length,
            trackCount: data.track_count || 0,
            latencyMs: latency,
            lastAlert: data.last_alert || "—",
          });
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket]);

  // ─── Frame Loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected) return;
    let isProcessing = false;

    const interval = setInterval(async () => {
      if (!camera.current || isProcessing || !socket) return;
      if (socket.readyState !== WebSocket.OPEN) return;
      isProcessing = true;

      try {
        const photo = await camera.current.takeSnapshot({
          quality: FRAME_QUALITY,
        });
        if (photo?.path) {
          const base64 = await RNFS.readFile(photo.path, "base64");
          if (base64 && base64.length > 100) {
            frameSendTime.current = Date.now();

            // Track FPS
            const now = Date.now();
            frameTimestamps.current.push(now);
            frameTimestamps.current = frameTimestamps.current.filter(
              (t) => now - t < 1000
            );

            // Send with debug:true flag — backend annotates and returns frame
            socket.send(
              JSON.stringify({
                type: "video_frame",
                data: base64,
                debug: true,   // ← tells backend to annotate and echo frame back
              })
            );
          }
          await RNFS.unlink(photo.path);
        }
      } catch {
        // silent skip
      } finally {
        isProcessing = false;
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isConnected, socket]);

  // ─── Tier Color ───────────────────────────────────────────────────────────
  const getTierColor = (label: string, fast: boolean) => {
    if (fast) return "#FF3B30";
    const vehicles = ["car", "motorcycle", "bus", "truck", "bicycle"];
    if (vehicles.some((v) => label.includes(v))) return "#FF6B35";
    if (label.includes("person")) return "#FFD700";
    return "#34C759";
  };

  const getSectorIcon = (sector: string) => {
    if (sector === "left") return "◀";
    if (sector === "right") return "▶";
    return "▲";
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera not found</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Guardian Debug</Text>
        <View style={[styles.statusDot, { backgroundColor: isConnected ? "#34C759" : "#FF3B30" }]} />
      </View>

      {/* Annotated Frame */}
      <View style={styles.frameContainer}>
        {/* Live camera underneath */}
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          photo={true}
        />

        {/* Annotated frame overlay from backend */}
        {annotatedFrame ? (
          <Image
            source={{ uri: annotatedFrame }}
            style={styles.annotatedOverlay}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.waitingOverlay}>
            <Text style={styles.waitingText}>
              {isConnected ? "Waiting for frames..." : "🔴 Not connected"}
            </Text>
          </View>
        )}

        {/* Sector boundary lines */}
        <View style={styles.sectorLines} pointerEvents="none">
          <View style={styles.sectorLineLeft} />
          <View style={styles.sectorLineRight} />
          <Text style={styles.sectorLabelLeft}>LEFT</Text>
          <Text style={styles.sectorLabelCenter}>CENTER</Text>
          <Text style={styles.sectorLabelRight}>RIGHT</Text>
        </View>
      </View>

      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{frameTimestamps.current.length}</Text>
          <Text style={styles.statLabel}>FPS</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.objectCount}</Text>
          <Text style={styles.statLabel}>Objects</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.trackCount}</Text>
          <Text style={styles.statLabel}>Tracks</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, stats.latencyMs > 200 && styles.statValueWarn]}>
            {stats.latencyMs}ms
          </Text>
          <Text style={styles.statLabel}>Latency</Text>
        </View>
      </View>

      {/* Last Alert */}
      <View style={styles.lastAlertBar}>
        <Text style={styles.lastAlertLabel}>Last alert: </Text>
        <Text style={styles.lastAlertText}>{stats.lastAlert}</Text>
      </View>

      {/* Detection Log */}
      <ScrollView style={styles.logContainer} showsVerticalScrollIndicator={false}>
        {detectionLog.length === 0 ? (
          <Text style={styles.emptyLog}>No objects detected</Text>
        ) : (
          detectionLog.map((det) => (
            <View key={det.id} style={styles.logRow}>
              <Text style={styles.logSector}>{getSectorIcon(det.sector)}</Text>
              <View style={[styles.logDot, { backgroundColor: getTierColor(det.label, det.fast) }]} />
              <Text style={styles.logLabel}>{det.label}</Text>
              {det.fast && <Text style={styles.fastBadge}>FAST</Text>}
              <Text style={styles.logDist}>{det.dist}</Text>
              <Text style={styles.logPriority}>P:{Math.round(det.priority)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  errorText: { color: "white", textAlign: "center", marginTop: 50 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1C1C1E",
  },
  backBtn: { paddingRight: 16 },
  backText: { color: "#007AFF", fontSize: 16 },
  title: { flex: 1, color: "white", fontSize: 17, fontWeight: "700" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  frameContainer: {
    height: 280,
    backgroundColor: "#000",
    position: "relative",
  },
  annotatedOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.92,
  },
  waitingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  waitingText: { color: "#8E8E93", fontSize: 14 },

  // Sector boundary lines
  sectorLines: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  sectorLineLeft: {
    position: "absolute",
    left: "30%",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  sectorLineRight: {
    position: "absolute",
    left: "70%",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  sectorLabelLeft: {
    position: "absolute",
    left: "5%",
    bottom: 6,
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
  sectorLabelCenter: {
    position: "absolute",
    left: "40%",
    bottom: 6,
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
  sectorLabelRight: {
    position: "absolute",
    right: "5%",
    bottom: 6,
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },

  statsBar: {
    flexDirection: "row",
    backgroundColor: "#1C1C1E",
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: { alignItems: "center", flex: 1 },
  statValue: { color: "#FFD700", fontSize: 18, fontWeight: "800" },
  statValueWarn: { color: "#FF3B30" },
  statLabel: { color: "#8E8E93", fontSize: 10, marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: "#3A3A3C" },

  lastAlertBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#111",
    borderBottomWidth: 1,
    borderBottomColor: "#1C1C1E",
  },
  lastAlertLabel: { color: "#8E8E93", fontSize: 13 },
  lastAlertText: { color: "#FFD700", fontSize: 13, fontWeight: "600", flex: 1 },

  logContainer: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  emptyLog: { color: "#3A3A3C", textAlign: "center", marginTop: 20, fontSize: 14 },

  logRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1C1C1E",
    gap: 8,
  },
  logSector: { color: "#8E8E93", fontSize: 14, width: 16 },
  logDot: { width: 10, height: 10, borderRadius: 5 },
  logLabel: { color: "white", fontSize: 14, fontWeight: "600", flex: 1 },
  fastBadge: {
    backgroundColor: "#FF3B30",
    color: "white",
    fontSize: 9,
    fontWeight: "800",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  logDist: { color: "#8E8E93", fontSize: 13 },
  logPriority: { color: "#3A3A3C", fontSize: 11, width: 50, textAlign: "right" },
});

export default DebugScreen;