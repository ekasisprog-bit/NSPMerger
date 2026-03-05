import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";

interface FolderPickerProps {
  folderUri: string | null;
  onPick: () => void;
  disabled?: boolean;
}

export function FolderPicker({ folderUri, onPick, disabled }: FolderPickerProps) {
  const folderName = folderUri
    ? decodeURIComponent(folderUri.split("%2F").pop() || folderUri.split("/").pop() || "Selected")
    : null;

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
          disabled && styles.buttonDisabled,
        ]}
        onPress={onPick}
        disabled={disabled}
      >
        <Text style={styles.icon}>&#128193;</Text>
        <View style={styles.textContainer}>
          <Text style={styles.buttonText}>
            {folderUri ? "Change Folder" : "Select Folder"}
          </Text>
          {folderName && (
            <Text style={styles.folderName} numberOfLines={1}>
              {folderName}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E2E",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: "#2A2A3E",
    borderStyle: "dashed",
  },
  buttonPressed: {
    backgroundColor: "#252540",
    borderColor: "#7C3AED",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  icon: {
    fontSize: 32,
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
  },
  buttonText: {
    color: "#E2E8F0",
    fontSize: 17,
    fontWeight: "600",
  },
  folderName: {
    color: "#7C3AED",
    fontSize: 13,
    marginTop: 4,
    fontWeight: "500",
  },
});
