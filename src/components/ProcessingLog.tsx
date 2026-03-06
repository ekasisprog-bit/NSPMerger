import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";

interface ProcessingLogProps {
  log: string[];
}

export function ProcessingLog({ log }: ProcessingLogProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (scrollRef.current && log.length > 0) {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [log.length]);

  if (log.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Processing Log</Text>
      <ScrollView
        ref={scrollRef}
        style={styles.logScroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {log.map((line, i) => (
          <Text
            key={i}
            style={[
              styles.logLine,
              line.startsWith("ERROR") && styles.logError,
              line.startsWith("  WARNING") && styles.logWarning,
              line.startsWith("---") && styles.logHeader,
              line.startsWith("  MERGE GROUP") && styles.logMerge,
              line.startsWith("  STANDALONE") && styles.logStandalone,
              line.startsWith("  UNKNOWN") && styles.logUnknown,
            ]}
          >
            {line}
          </Text>
        ))}
      </ScrollView>
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
    maxHeight: 300,
  },
  title: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  logScroll: {
    flex: 1,
  },
  logLine: {
    color: "#94A3B8",
    fontSize: 11,
    fontFamily: "monospace",
    lineHeight: 16,
  },
  logError: {
    color: "#EF4444",
    fontWeight: "700",
  },
  logWarning: {
    color: "#F59E0B",
    fontWeight: "600",
  },
  logHeader: {
    color: "#E2E8F0",
    fontWeight: "700",
    marginTop: 4,
  },
  logMerge: {
    color: "#7C3AED",
    fontWeight: "600",
  },
  logStandalone: {
    color: "#10B981",
  },
  logUnknown: {
    color: "#64748B",
    fontStyle: "italic",
  },
});
