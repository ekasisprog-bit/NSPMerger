import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { ProcessingProgress } from "@/types";
import { StatusBadge } from "./StatusBadge";
import { formatBytes, formatPercentage } from "@/utils/formatters";

interface ProgressCardProps {
  progress: ProcessingProgress;
}

export function ProgressCard({ progress }: ProgressCardProps) {
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: progress.percentage,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress.percentage]);

  const isActive = !["idle", "done", "error"].includes(progress.phase);

  if (!isActive && progress.phase === "idle") return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <StatusBadge phase={progress.phase} />
        {progress.totalFiles > 0 && (
          <Text style={styles.counter}>
            {progress.fileIndex}/{progress.totalFiles}
          </Text>
        )}
      </View>

      {progress.currentFile ? (
        <Text style={styles.fileName} numberOfLines={2}>
          {progress.currentFile}
        </Text>
      ) : null}

      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.statText}>{formatPercentage(progress.percentage)}</Text>
        {progress.totalBytes > 0 && (
          <Text style={styles.statText}>
            {formatBytes(progress.bytesProcessed)} / {formatBytes(progress.totalBytes)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1E1E2E",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2A2A3E",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  counter: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  fileName: {
    color: "#CBD5E1",
    fontSize: 14,
    marginBottom: 16,
    fontFamily: "monospace",
    lineHeight: 20,
  },
  progressTrack: {
    height: 6,
    backgroundColor: "#0F0F1A",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#7C3AED",
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statText: {
    color: "#64748B",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
});
