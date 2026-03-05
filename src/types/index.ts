export interface FileEntry {
  uri: string;
  name: string;
  size: number;
}

export interface FilePart {
  uri: string;
  name: string;
  size: number;
  index: number;
}

export interface FileGroup {
  baseName: string;
  outputName: string;
  parts: FilePart[];
  totalSize: number;
  patternType: PatternType;
}

export type PatternType =
  | "ns_numbered" // .ns0, .ns1, ...
  | "nsp_dotted" // .nsp.00, .nsp.01, ...
  | "xc_numbered" // .xc0, .xc1, ...
  | "nsp_part" // .nsp.part0, .nsp.part1, ...
  | "bare_numbered"; // 00, 01, ... in named folder

export interface StandaloneNsp {
  uri: string;
  name: string;
  size: number;
}

export interface ScanResult {
  groups: FileGroup[];
  standaloneNsps: StandaloneNsp[];
  unknownFiles: string[];
}

export type ProcessingPhase =
  | "idle"
  | "selecting"
  | "copying"
  | "extracting"
  | "scanning"
  | "merging"
  | "cleanup"
  | "done"
  | "error";

export interface ProcessingProgress {
  phase: ProcessingPhase;
  currentFile: string;
  fileIndex: number;
  totalFiles: number;
  bytesProcessed: number;
  totalBytes: number;
  percentage: number;
}

export interface ProcessingResult {
  mergedFiles: string[];
  standaloneFiles: string[];
  totalSize: number;
  elapsedMs: number;
  errors: string[];
}

export type ProcessingAction =
  | { type: "START_SELECTING" }
  | { type: "FOLDER_SELECTED"; folderUri: string }
  | { type: "START_COPYING"; totalFiles: number }
  | { type: "START_EXTRACTING"; totalFiles: number }
  | { type: "START_SCANNING" }
  | { type: "SCAN_COMPLETE"; scanResult: ScanResult }
  | { type: "START_MERGING"; totalGroups: number }
  | { type: "START_CLEANUP" }
  | { type: "UPDATE_PROGRESS"; progress: Partial<ProcessingProgress> }
  | { type: "COMPLETE"; result: ProcessingResult }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

export interface ProcessingState {
  phase: ProcessingPhase;
  folderUri: string | null;
  progress: ProcessingProgress;
  scanResult: ScanResult | null;
  result: ProcessingResult | null;
  errorMessage: string | null;
}
