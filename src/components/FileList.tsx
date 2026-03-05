import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { ProcessingResult, ScanResult } from "@/types";
import { formatBytes, formatDuration } from "@/utils/formatters";

interface FileListProps {
  scanResult: ScanResult | null;
  result: ProcessingResult | null;
}

export function FileList({ scanResult, result }: FileListProps) {
  if (!result && !scanResult) return null;

  return (
    <View style={styles.container}>
      {result && (
        <>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Processing Complete</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Merged</Text>
              <Text style={styles.summaryValue}>{result.mergedFiles.length} files</Text>
            </View>
            {result.standaloneFiles.length > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Standalone</Text>
                <Text style={styles.summaryValue}>
                  {result.standaloneFiles.length} files
                </Text>
              </View>
            )}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Size</Text>
              <Text style={styles.summaryValue}>{formatBytes(result.totalSize)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Time</Text>
              <Text style={styles.summaryValue}>{formatDuration(result.elapsedMs)}</Text>
            </View>
          </View>

          {result.mergedFiles.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Merged Files</Text>
              {result.mergedFiles.map((name) => (
                <View key={name} style={styles.fileRow}>
                  <View style={[styles.statusDot, styles.dotSuccess]} />
                  <Text style={styles.fileName} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {result.standaloneFiles.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Standalone NSPs</Text>
              {result.standaloneFiles.map((name) => (
                <View key={name} style={styles.fileRow}>
                  <View style={[styles.statusDot, styles.dotInfo]} />
                  <Text style={styles.fileName} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {result.errors.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, styles.errorTitle]}>Errors</Text>
              {result.errors.map((err, i) => (
                <View key={i} style={styles.fileRow}>
                  <View style={[styles.statusDot, styles.dotError]} />
                  <Text style={[styles.fileName, styles.errorText]} numberOfLines={2}>
                    {err}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {!result && scanResult && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Discovered Groups</Text>
          {scanResult.groups.map((group) => (
            <View key={group.baseName} style={styles.groupCard}>
              <Text style={styles.groupName}>{group.outputName}</Text>
              <Text style={styles.groupMeta}>
                {group.parts.length} parts | {formatBytes(group.totalSize)} |{" "}
                {group.patternType}
              </Text>
            </View>
          ))}
          {scanResult.standaloneNsps.map((nsp) => (
            <View key={nsp.name} style={styles.fileRow}>
              <View style={[styles.statusDot, styles.dotInfo]} />
              <Text style={styles.fileName} numberOfLines={1}>
                {nsp.name} ({formatBytes(nsp.size)})
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  summaryCard: {
    backgroundColor: "#0D2818",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#10B981",
  },
  summaryTitle: {
    color: "#10B981",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  summaryLabel: {
    color: "#6EE7B7",
    fontSize: 14,
  },
  summaryValue: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  errorTitle: {
    color: "#EF4444",
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#1E1E2E",
    borderRadius: 10,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  dotSuccess: {
    backgroundColor: "#10B981",
  },
  dotInfo: {
    backgroundColor: "#3B82F6",
  },
  dotError: {
    backgroundColor: "#EF4444",
  },
  fileName: {
    color: "#CBD5E1",
    fontSize: 14,
    flex: 1,
    fontFamily: "monospace",
  },
  errorText: {
    color: "#FCA5A5",
  },
  groupCard: {
    backgroundColor: "#1E1E2E",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#7C3AED",
  },
  groupName: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "monospace",
    marginBottom: 4,
  },
  groupMeta: {
    color: "#64748B",
    fontSize: 12,
  },
});
