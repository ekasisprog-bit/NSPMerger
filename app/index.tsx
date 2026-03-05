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
  const { state, pickFolder, startProcessing, reset } = useProcessing();

  const isProcessing = !["idle", "done", "error"].includes(state.phase);
  const canStart = state.folderUri && !isProcessing && state.phase !== "done";

  const handleStart = () => {
    Alert.alert(
      "Start Processing",
      "This will extract all zip files, merge split NSP parts, copy results back to the selected folder, and clean up. Continue?",
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

        {/* Start Button */}
        {canStart && (
          <Pressable
            style={({ pressed }) => [
              styles.startButton,
              pressed && styles.startButtonPressed,
            ]}
            onPress={handleStart}
          >
            <Text style={styles.startButtonText}>Start Processing</Text>
          </Pressable>
        )}

        {/* Progress */}
        <ProgressCard progress={state.progress} />

        {/* Error */}
        {state.phase === "error" && state.errorMessage && (
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
