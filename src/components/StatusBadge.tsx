import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ProcessingPhase } from "@/types";

const PHASE_CONFIG: Record<ProcessingPhase, { label: string; color: string }> = {
  idle: { label: "Ready", color: "#6B7280" },
  selecting: { label: "Selecting", color: "#8B5CF6" },
  copying: { label: "Copying", color: "#3B82F6" },
  extracting: { label: "Extracting", color: "#F59E0B" },
  scanning: { label: "Scanning", color: "#6366F1" },
  merging: { label: "Merging", color: "#10B981" },
  cleanup: { label: "Cleaning Up", color: "#6B7280" },
  done: { label: "Complete", color: "#10B981" },
  error: { label: "Error", color: "#EF4444" },
};

interface StatusBadgeProps {
  phase: ProcessingPhase;
}

export function StatusBadge({ phase }: StatusBadgeProps) {
  const config = PHASE_CONFIG[phase];

  return (
    <View style={[styles.badge, { backgroundColor: `${config.color}20` }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
