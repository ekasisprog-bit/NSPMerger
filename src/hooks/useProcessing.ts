import { useReducer, useCallback, useState, useRef } from "react";
import {
  ProcessingState,
  ProcessingAction,
  ProcessingProgress,
} from "@/types";
import { runPipeline, CancelHandle, CancelledError } from "@/services/processingPipeline";
import NspNativeOps from "../../modules/nsp-native-ops";
import { isArchiveFile } from "@/utils/patterns";

const initialProgress: ProcessingProgress = {
  phase: "idle",
  currentFile: "",
  fileIndex: 0,
  totalFiles: 0,
  bytesProcessed: 0,
  totalBytes: 0,
  percentage: 0,
  overallPercentage: 0,
};

const initialState: ProcessingState = {
  phase: "idle",
  folderUri: null,
  progress: initialProgress,
  tasks: [],
  scanResult: null,
  result: null,
  errorMessage: null,
};

function reducer(state: ProcessingState, action: ProcessingAction): ProcessingState {
  switch (action.type) {
    case "START_SELECTING":
      return { ...initialState, phase: "selecting" };
    case "FOLDER_SELECTED":
      return { ...state, phase: "idle", folderUri: action.folderUri };
    case "START_COPYING":
      return {
        ...state,
        phase: "copying",
        progress: { ...initialProgress, phase: "copying", totalFiles: action.totalFiles },
      };
    case "START_EXTRACTING":
      return {
        ...state,
        phase: "extracting",
        progress: { ...state.progress, phase: "extracting", totalFiles: action.totalFiles },
      };
    case "START_SCANNING":
      return {
        ...state,
        phase: "scanning",
        progress: { ...state.progress, phase: "scanning" },
      };
    case "SCAN_COMPLETE":
      return { ...state, scanResult: action.scanResult };
    case "START_MERGING":
      return {
        ...state,
        phase: "merging",
        progress: {
          ...state.progress,
          phase: "merging",
          totalFiles: action.totalGroups,
          fileIndex: 0,
          percentage: 0,
        },
      };
    case "START_CLEANUP":
      return {
        ...state,
        phase: "cleanup",
        progress: { ...state.progress, phase: "cleanup" },
      };
    case "UPDATE_PROGRESS":
      return {
        ...state,
        progress: { ...state.progress, ...action.progress },
      };
    case "SET_TASKS":
      return { ...state, tasks: action.tasks };
    case "UPDATE_TASK": {
      const tasks = [...state.tasks];
      if (tasks[action.index]) {
        tasks[action.index] = { ...tasks[action.index], ...action.task };
      }
      return { ...state, tasks };
    }
    case "COMPLETE":
      return {
        ...state,
        phase: "done",
        progress: { ...state.progress, phase: "done", percentage: 100, overallPercentage: 100 },
        result: action.result,
      };
    case "ERROR":
      return {
        ...state,
        phase: "error",
        errorMessage: action.message,
      };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export interface FolderScanInfo {
  totalFiles: number;
  archiveFiles: number;
  fileNames: string[];
  archiveNames: string[];
}

export function useProcessing() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [folderScan, setFolderScan] = useState<FolderScanInfo | null>(null);
  const cancelRef = useRef<CancelHandle | null>(null);

  const pickFolder = useCallback(async () => {
    dispatch({ type: "START_SELECTING" });
    try {
      const uri = await NspNativeOps.pickDirectory();
      dispatch({ type: "FOLDER_SELECTED", folderUri: uri });

      // Immediately scan the folder to show what's inside
      try {
        const files = await NspNativeOps.listDirectoryFiles(uri);
        const archiveNames = files.filter((f) => isArchiveFile(f.name)).map((f) => f.name);
        setFolderScan({
          totalFiles: files.length,
          archiveFiles: archiveNames.length,
          fileNames: files.map((f) => f.name),
          archiveNames,
        });
      } catch (e: any) {
        setFolderScan(null);
        dispatch({ type: "ERROR", message: `Cannot read folder: ${e.message}` });
      }
    } catch (e: any) {
      if (e.code !== "CANCELLED") {
        dispatch({ type: "ERROR", message: `Folder picker failed: ${e.message}` });
      } else {
        dispatch({ type: "RESET" });
      }
    }
  }, []);

  const startProcessing = useCallback(async () => {
    if (!state.folderUri) return;

    const handle: CancelHandle = { cancelled: false };
    cancelRef.current = handle;

    try {
      const result = await runPipeline(
        state.folderUri,
        {
          onPhaseChange: (phase) => {
            if (phase === "copying") {
              dispatch({ type: "START_COPYING", totalFiles: 0 });
            } else if (phase === "extracting") {
              dispatch({ type: "START_EXTRACTING", totalFiles: 0 });
            } else if (phase === "scanning") {
              dispatch({ type: "START_SCANNING" });
            } else if (phase === "merging") {
              dispatch({ type: "START_MERGING", totalGroups: 0 });
            } else {
              dispatch({ type: "START_CLEANUP" });
            }
          },
          onProgress: (update) => {
            dispatch({ type: "UPDATE_PROGRESS", progress: update });
          },
          onSetTasks: (tasks) => {
            dispatch({ type: "SET_TASKS", tasks });
          },
          onTaskUpdate: (index, task) => {
            dispatch({ type: "UPDATE_TASK", index, task });
          },
          onScanComplete: (scanResult) => {
            dispatch({ type: "SCAN_COMPLETE", scanResult });
          },
          onError: (_message) => {
            // Non-fatal errors are collected by the pipeline
          },
        },
        handle
      );

      dispatch({ type: "COMPLETE", result });
    } catch (e: any) {
      if (e instanceof CancelledError) {
        dispatch({ type: "ERROR", message: "Processing cancelled. Cache cleaned up." });
      } else {
        dispatch({ type: "ERROR", message: e.message });
      }
    } finally {
      cancelRef.current = null;
    }
  }, [state.folderUri]);

  const cancelProcessing = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current.cancelled = true;
    }
  }, []);

  const reset = useCallback(() => {
    setFolderScan(null);
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    folderScan,
    pickFolder,
    startProcessing,
    cancelProcessing,
    reset,
  };
}
