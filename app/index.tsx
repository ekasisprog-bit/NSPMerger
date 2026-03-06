import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useProcessing } from "../src/hooks/useProcessing";
import { FolderPicker } from "../src/components/FolderPicker";
import { ProgressCard } from "../src/components/ProgressCard";
import { FileList } from "../src/components/FileList";

export default function HomeScreen() {
  const { state, folderScan, pickFolder, startProcessing, reset } = useProcessing();

  const isProcessing = !["idle", "done", "error"].includes(state.phase);
  const canStart = state.folderUri != null && !isProcessing && state.phase !== "done";

  const handleStart = () => {
    Alert.alert(
      "Start Processing",
      "This will extract all archive files, merge split NSP parts, and save the merged NSP files to the selected folder. Original files will be kept. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Start", onPress: startProcessing },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>NSP Merger</Text>
          <Text style={styles.subtitle}>
            Extract & merge split NSP files
          </Text>
        </View>

        {/* Folder Picker */}
        <FolderPicker
          folderUri={state.folderUri}
          onPick={pickFolder}
          disabled={isProcessing}
        />

        {/* Folder Scan Results */}
        {folderScan != null && state.phase === "idle" && (
          <View style={styles.scanCard}>
            <Text style={styles.scanTitle}>Folder Contents</Text>
            <View style={styles.scanRow}>
              <Text style={styles.scanLabel}>Total files</Text>
              <Text style={styles.scanValue}>{folderScan.totalFiles}</Text>
            </View>
            <View style={styles.scanRow}>
              <Text style={styles.scanLabel}>Archive files</Text>
              <Text style={[
                styles.scanValue,
                folderScan.archiveFiles === 0 && styles.scanValueError,
              ]}>
                {folderScan.archiveFiles}
              </Text>
            </View>
            {folderScan.archiveFiles > 0 && (
              <View style={styles.scanFiles}>
                {folderScan.archiveNames.map((name) => (
                  <Text key={name} style={styles.scanFileName} numberOfLines={1}>
                    {name}
                  </Text>
                ))}
              </View>
            )}
            {folderScan.archiveFiles === 0 && folderScan.totalFiles > 0 && (
              <View style={styles.scanFiles}>
                <Text style={styles.scanWarning}>
                  No archive files (.zip/.rar) found. Files in folder:
                </Text>
                {folderScan.fileNames.slice(0, 10).map((name) => (
                  <Text key={name} style={styles.scanFileName} numberOfLines={1}>
                    {name}
                  </Text>
                ))}
                {folderScan.fileNames.length > 10 && (
                  <Text style={styles.scanMeta}>
                    ...and {folderScan.fileNames.length - 10} more
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Start Button */}
        {canStart && folderScan != null && folderScan.archiveFiles > 0 && (
          <Pressable
            style={({ pressed }) => [
              styles.startButton,
              pressed && styles.startButtonPressed,
            ]}
            onPress={handleStart}
          >
            <Text style={styles.startButtonText}>
              Start Processing ({folderScan.archiveFiles} archives)
            </Text>
          </Pressable>
        )}

        {/* Progress */}
        <ProgressCard progress={state.progress} />

        {/* Error */}
        {state.phase === "error" && state.errorMessage != null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorMessage}>{state.errorMessage}</Text>
          </View>
        )}

        {/* Results / File List */}
        <FileList scanResult={state.scanResult} result={state.result} />

        {/* Reset Button */}
        {(state.phase === "done" || state.phase === "error") && (
          <Pressable
            style={({ pressed }) => [
              styles.resetButton,
              pressed && styles.resetButtonPressed,
            ]}
            onPress={reset}
          >
            <Text style={styles.resetButtonText}>Process Another Folder</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0F0F1A",
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
    marginTop: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#F1F5F9",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748B",
    marginTop: 6,
  },
  scanCard: {
    backgroundColor: "#1E1E2E",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2A2A3E",
  },
  scanTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  scanRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  scanLabel: {
    color: "#64748B",
    fontSize: 14,
  },
  scanValue: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  scanValueError: {
    color: "#EF4444",
  },
  scanFiles: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#2A2A3E",
  },
  scanFileName: {
    color: "#7C3AED",
    fontSize: 13,
    fontFamily: "monospace",
    paddingVertical: 3,
  },
  scanWarning: {
    color: "#F59E0B",
    fontSize: 13,
    marginBottom: 8,
  },
  scanMeta: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 4,
  },
  startButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  startButtonPressed: {
    backgroundColor: "#6D28D9",
    transform: [{ scale: 0.98 }],
  },
  startButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  errorCard: {
    backgroundColor: "#1C0A0A",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EF4444",
  },
  errorTitle: {
    color: "#EF4444",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  errorMessage: {
    color: "#FCA5A5",
    fontSize: 14,
    lineHeight: 20,
  },
  resetButton: {
    borderWidth: 1.5,
    borderColor: "#2A2A3E",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  resetButtonPressed: {
    backgroundColor: "#1E1E2E",
  },
  resetButtonText: {
    color: "#94A3B8",
    fontSize: 16,
    fontWeight: "600",
  },
});
