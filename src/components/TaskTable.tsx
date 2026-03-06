import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ArchiveTask, ArchiveTaskStatus } from "@/types";

interface TaskTableProps {
  tasks: ArchiveTask[];
}

const STATUS_LABELS: Record<ArchiveTaskStatus, string> = {
  pending: "Pending",
  copying: "Copying",
  extracting: "Extracting",
  grouping: "Grouping",
  merging: "Merging",
  copying_back: "Copying Back",
  done: "Done",
  error: "Error",
};

const STATUS_COLORS: Record<ArchiveTaskStatus, string> = {
  pending: "#64748B",
  copying: "#F59E0B",
  extracting: "#3B82F6",
  grouping: "#8B5CF6",
  merging: "#7C3AED",
  copying_back: "#06B6D4",
  done: "#10B981",
  error: "#EF4444",
};

export function TaskTable({ tasks }: TaskTableProps) {
  if (tasks.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Archives</Text>
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.nameCol]}>Archive</Text>
        <Text style={[styles.headerCell, styles.statusCol]}>Status</Text>
      </View>
      {tasks.map((task) => {
        const isActive = !["pending", "done", "error"].includes(task.status);
        return (
          <View
            key={task.name}
            style={[styles.row, isActive && styles.activeRow]}
          >
            <Text
              style={[styles.cell, styles.nameCol, styles.nameText]}
              numberOfLines={1}
            >
              {task.name}
            </Text>
            <View style={[styles.statusCol, styles.statusContainer]}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: STATUS_COLORS[task.status] },
                ]}
              />
              <Text
                style={[
                  styles.cell,
                  styles.statusText,
                  { color: STATUS_COLORS[task.status] },
                ]}
              >
                {STATUS_LABELS[task.status]}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1E1E2E",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2A2A3E",
  },
  title: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A3E",
    marginBottom: 4,
  },
  headerCell: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1A1A2A",
  },
  activeRow: {
    backgroundColor: "#252540",
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderBottomColor: "transparent",
  },
  cell: {
    fontSize: 13,
  },
  nameCol: {
    flex: 1,
  },
  statusCol: {
    width: 110,
  },
  nameText: {
    color: "#CBD5E1",
    fontFamily: "monospace",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontWeight: "600",
  },
});
