import { NativeModule, requireNativeModule } from "expo";

export interface ExtractProgressEvent {
  bytesExtracted: number;
  totalBytes: number;
  currentEntry: string;
  percentage: number;
}

export interface MergeProgressEvent {
  bytesWritten: number;
  totalBytes: number;
  currentPart: string;
  percentage: number;
}

type NspNativeOpsModuleEvents = {
  onExtractProgress: (event: ExtractProgressEvent) => void;
  onMergeProgress: (event: MergeProgressEvent) => void;
  [key: string]: (...args: any[]) => void;
}

export interface FileInfo {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface ExtractResult {
  extractedFiles: string[];
  totalBytes: number;
}

export interface MergeResult {
  outputPath: string;
  totalBytes: number;
}

declare class NspNativeOpsModuleType extends NativeModule<NspNativeOpsModuleEvents> {
  pickDirectory(): Promise<string>;
  listDirectoryFiles(uri: string): Promise<FileInfo[]>;
  copyToCache(uri: string, fileName: string): Promise<string>;
  copyFromCache(
    cachePath: string,
    destTreeUri: string,
    fileName: string
  ): Promise<string>;
  extractZip(zipPath: string, destDir: string): Promise<ExtractResult>;
  mergeFiles(inputPaths: string[], outputPath: string): Promise<MergeResult>;
  deleteFiles(paths: string[]): Promise<number>;
  deleteSafDocument(uri: string): Promise<boolean>;
  getFreeDiskSpace(): Promise<number>;
  getCacheDir(): Promise<string>;
}

export default requireNativeModule<NspNativeOpsModuleType>("NspNativeOps");
