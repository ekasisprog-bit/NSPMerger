import NspNativeOps from "../../modules/nsp-native-ops";
import { FileEntry, ProcessingResult, ScanResult } from "@/types";
import { groupFiles } from "./nspGrouper";
import { isZipFile, isRarFile, isArchiveFile } from "@/utils/patterns";

interface PipelineCallbacks {
  onPhaseChange: (phase: string) => void;
  onProgress: (update: {
    currentFile?: string;
    fileIndex?: number;
    totalFiles?: number;
    bytesProcessed?: number;
    totalBytes?: number;
    percentage?: number;
  }) => void;
  onError: (message: string) => void;
}

export async function runPipeline(
  folderUri: string,
  callbacks: PipelineCallbacks
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const mergedFiles: string[] = [];
  const standaloneFiles: string[] = [];
  const cacheDir = await NspNativeOps.getCacheDir();

  try {
    // Step 1: List files in the selected folder
    callbacks.onPhaseChange("copying");
    callbacks.onProgress({ currentFile: "Scanning folder..." });

    let allFiles;
    try {
      allFiles = await NspNativeOps.listDirectoryFiles(folderUri);
    } catch (e: any) {
      throw new Error(`Failed to list files in folder: ${e.message}`);
    }

    if (!allFiles || allFiles.length === 0) {
      throw new Error("Folder is empty or cannot be read.");
    }

    const archiveFiles = allFiles.filter((f) => isArchiveFile(f.name));

    if (archiveFiles.length === 0) {
      const fileNames = allFiles.map((f) => f.name).join(", ");
      throw new Error(
        `No archive files (.zip/.rar) found. Found ${allFiles.length} files: ${fileNames}`
      );
    }

    callbacks.onProgress({
      currentFile: `Found ${archiveFiles.length} archive files`,
      totalFiles: archiveFiles.length,
    });

    // Step 2: Check disk space
    const freeSpace = await NspNativeOps.getFreeDiskSpace();
    const largestArchive = Math.max(...archiveFiles.map((f) => f.size));
    if (largestArchive > 0 && freeSpace < largestArchive * 2) {
      throw new Error(
        `Insufficient disk space. Need ~${formatBytesSimple(largestArchive * 2)} free, have ${formatBytesSimple(freeSpace)}.`
      );
    }

    // Step 3: Copy zips to cache & extract
    const allExtractedFiles: FileEntry[] = [];

    for (let i = 0; i < archiveFiles.length; i++) {
      const archive = archiveFiles[i];
      const archiveIsRar = isRarFile(archive.name);

      callbacks.onProgress({
        currentFile: `Copying ${archive.name}...`,
        fileIndex: i + 1,
        totalFiles: archiveFiles.length,
        percentage: 0,
      });

      // Copy archive to cache
      callbacks.onPhaseChange("copying");
      let cachedPath: string;
      try {
        cachedPath = await NspNativeOps.copyToCache(archive.uri, archive.name);
      } catch (e: any) {
        errors.push(`Failed to copy ${archive.name}: ${e.message}`);
        continue;
      }

      // Extract archive
      callbacks.onPhaseChange("extracting");
      callbacks.onProgress({
        currentFile: `Extracting ${archive.name}...`,
        percentage: 0,
      });

      const extractDir = `${cacheDir}/extract_${i}`;

      const extractSub = NspNativeOps.addListener("onExtractProgress", (event) => {
        callbacks.onProgress({
          bytesProcessed: event.bytesExtracted,
          totalBytes: event.totalBytes,
          percentage: event.percentage,
          currentFile: `Extracting: ${event.currentEntry}`,
        });
      });

      try {
        const result = archiveIsRar
          ? await NspNativeOps.extractRar(cachedPath, extractDir)
          : await NspNativeOps.extractZip(cachedPath, extractDir);

        for (const filePath of result.extractedFiles) {
          const pathParts = filePath.split("/");
          const fileName = pathParts.pop() || filePath;
          // Include parent dir in name for bare-numbered files (00, 01)
          // to prevent cross-archive contamination during grouping
          const parentDir = pathParts.pop() || "";
          const qualifiedName = /^\d+$/.test(fileName) && parentDir
            ? `${parentDir}/${fileName}`
            : fileName;
          allExtractedFiles.push({
            uri: filePath,
            name: qualifiedName,
            size: 0,
          });
        }
      } catch (e: any) {
        errors.push(`Failed to extract ${archive.name}: ${e.message}`);
      } finally {
        extractSub.remove();
      }

      // Delete cached archive immediately to free space
      try {
        await NspNativeOps.deleteFiles([cachedPath]);
      } catch {}
    }

    if (allExtractedFiles.length === 0) {
      throw new Error(
        `No files were extracted from ${archiveFiles.length} archives. Errors: ${errors.join("; ")}`
      );
    }

    // Step 4: Scan & Group extracted files
    callbacks.onPhaseChange("scanning");
    callbacks.onProgress({
      currentFile: `Scanning ${allExtractedFiles.length} extracted files...`,
    });

    const scanResult: ScanResult = groupFiles(allExtractedFiles);

    callbacks.onProgress({
      currentFile: `Found ${scanResult.groups.length} merge groups, ${scanResult.standaloneNsps.length} standalone NSPs`,
    });

    if (scanResult.groups.length === 0 && scanResult.standaloneNsps.length === 0) {
      const extractedNames = allExtractedFiles.map((f) => f.name).join(", ");
      throw new Error(
        `No NSP parts or standalone NSPs found in extracted files. Files found: ${extractedNames}`
      );
    }

    // Step 5: Merge each group
    if (scanResult.groups.length > 0) {
      callbacks.onPhaseChange("merging");
      callbacks.onProgress({
        totalFiles: scanResult.groups.length,
        currentFile: `Merging ${scanResult.groups.length} groups...`,
      });

      for (let i = 0; i < scanResult.groups.length; i++) {
        const group = scanResult.groups[i];
        callbacks.onProgress({
          currentFile: `Merging: ${group.outputName}`,
          fileIndex: i + 1,
          percentage: 0,
        });

        const outputPath = `${cacheDir}/${group.outputName}`;

        const mergeSub = NspNativeOps.addListener("onMergeProgress", (event) => {
          callbacks.onProgress({
            bytesProcessed: event.bytesWritten,
            totalBytes: event.totalBytes,
            percentage: event.percentage,
            currentFile: `Merging: ${group.outputName} (${event.currentPart})`,
          });
        });

        try {
          const inputPaths = group.parts.map((p) => p.uri);
          await NspNativeOps.mergeFiles(inputPaths, outputPath);

          // Copy merged file back to the source folder via SAF
          await NspNativeOps.copyFromCache(outputPath, folderUri, group.outputName);
          mergedFiles.push(group.outputName);

          // Delete merged cache file
          await NspNativeOps.deleteFiles([outputPath]);
        } catch (e: any) {
          errors.push(`Failed to merge ${group.outputName}: ${e.message}`);
        } finally {
          mergeSub.remove();
        }

        // Delete source parts
        try {
          const partPaths = group.parts.map((p) => p.uri);
          await NspNativeOps.deleteFiles(partPaths);
        } catch {}
      }
    }

    // Step 6: Move standalone NSPs back to SAF folder
    for (const nsp of scanResult.standaloneNsps) {
      callbacks.onProgress({ currentFile: `Copying: ${nsp.name}` });
      try {
        await NspNativeOps.copyFromCache(nsp.uri, folderUri, nsp.name);
        standaloneFiles.push(nsp.name);
      } catch (e: any) {
        errors.push(`Failed to copy standalone ${nsp.name}: ${e.message}`);
      }
    }

    // Step 7: Cleanup
    callbacks.onPhaseChange("cleanup");
    callbacks.onProgress({ currentFile: "Cleaning up cache..." });
    try {
      await NspNativeOps.deleteFiles([cacheDir]);
    } catch {}

    // Keep original archive files — user wants to retain them

    const totalSize =
      scanResult.groups.reduce((sum, g) => sum + g.totalSize, 0) +
      scanResult.standaloneNsps.reduce((sum, n) => sum + n.size, 0);

    return {
      mergedFiles,
      standaloneFiles,
      totalSize,
      elapsedMs: Date.now() - startTime,
      errors,
    };
  } catch (e: any) {
    // Attempt cleanup on error
    try {
      await NspNativeOps.deleteFiles([cacheDir]);
    } catch {}

    throw e;
  }
}

function formatBytesSimple(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}
