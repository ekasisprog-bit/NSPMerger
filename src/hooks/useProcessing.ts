import { useReducer, useCallback, useRef } from "react";
import {
  ProcessingState,
  ProcessingAction,
  ProcessingProgress,
  ProcessingPhase,
} from "@/types";
import { runPipeline } from "@/services/processingPipeline";
import NspNativeOps from "../../modules/nsp-native-ops";

const initialProgress: ProcessingProgress = {
  phase: "idle",
  currentFile: "",
  fileIndex: 0,
  totalFiles: 0,
  bytesProcessed: 0,
  totalBytes: 0,
  percentage: 0,
};

const initialState: ProcessingState = {
  phase: "idle",
  folderUri: null,
  progress: initialProgress,
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
    case "COMPLETE":
      return {
        ...state,
        phase: "done",
        progress: { ...state.progress, phase: "done", percentage: 100 },
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

export function useProcessing() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef(false);

  const pickFolder = useCallback(async () => {
    dispatch({ type: "START_SELECTING" });
    try {
      const uri = await NspNativeOps.pickDirectory();
      dispatch({ type: "FOLDER_SELECTED", folderUri: uri });
    } catch (e: any) {
      if (e.code !== "CANCELLED") {
        dispatch({ type: "ERROR", message: e.message });
      } else {
        dispatch({ type: "RESET" });
      }
    }
  }, []);

  const startProcessing = useCallback(async () => {
    if (!state.folderUri) return;
    abortRef.current = false;

    try {
      const result = await runPipeline(state.folderUri, {
        onPhaseChange: (phase) => {
          dispatch({
            type:
              phase === "copying"
                ? "START_COPYING"
                : phase === "extracting"
                  ? "START_EXTRACTING"
                  : phase === "scanning"
                    ? "START_SCANNING"
                    : phase === "merging"
                      ? "START_MERGING"
                      : "START_CLEANUP",
            totalFiles: 0,
            totalGroups: 0,
          } as any);
        },
        onProgress: (update) => {
          dispatch({ type: "UPDATE_PROGRESS", progress: update as Partial<ProcessingProgress> });
        },
        onError: (message) => {
          // Non-fatal errors are collected by the pipeline
        },
      });

      dispatch({ type: "COMPLETE", result });
    } catch (e: any) {
      dispatch({ type: "ERROR", message: e.message });
    }
  }, [state.folderUri]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    pickFolder,
    startProcessing,
    reset,
  };
}
