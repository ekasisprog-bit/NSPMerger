import NspNativeOps from "../../modules/nsp-native-ops";
import { FileEntry, ProcessingResult, ScanResult } from "@/types";
import { groupFiles } from "./nspGrouper";
import { isZipFile } from "@/utils/patterns";

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

    const zipFiles = allFiles.filter((f) => isZipFile(f.name));

    if (zipFiles.length === 0) {
      const fileNames = allFiles.map((f) => f.name).join(", ");
      throw new Error(
        `No .zip files found. Found ${allFiles.length} files: ${fileNames}`
      );
    }

    callbacks.onProgress({
      currentFile: `Found ${zipFiles.length} zip files`,
      totalFiles: zipFiles.length,
    });

    // Step 2: Check disk space
    const freeSpace = await NspNativeOps.getFreeDiskSpace();
    const largestZip = Math.max(...zipFiles.map((f) => f.size));
    if (largestZip > 0 && freeSpace < largestZip * 2) {
      throw new Error(
        `Insufficient disk space. Need ~${formatBytesSimple(largestZip * 2)} free, have ${formatBytesSimple(freeSpace)}.`
      );
    }

    // Step 3: Copy zips to cache & extract
    const allExtractedFiles: FileEntry[] = [];

    for (let i = 0; i < zipFiles.length; i++) {
      const zip = zipFiles[i];
      callbacks.onProgress({
        currentFile: `Copying ${zip.name}...`,
        fileIndex: i + 1,
        totalFiles: zipFiles.length,
        percentage: 0,
      });

      // Copy zip to cache
      callbacks.onPhaseChange("copying");
      let cachedZipPath: string;
      try {
        cachedZipPath = await NspNativeOps.copyToCache(zip.uri, zip.name);
      } catch (e: any) {
        errors.push(`Failed to copy ${zip.name}: ${e.message}`);
        continue;
      }

      // Extract zip
      callbacks.onPhaseChange("extracting");
      callbacks.onProgress({
        currentFile: `Extracting ${zip.name}...`,
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
        const result = await NspNativeOps.extractZip(cachedZipPath, extractDir);

        for (const filePath of result.extractedFiles) {
          const fileName = filePath.split("/").pop() || filePath;
          allExtractedFiles.push({
            uri: filePath,
            name: fileName,
            size: 0,
          });
        }
      } catch (e: any) {
        errors.push(`Failed to extract ${zip.name}: ${e.message}`);
      } finally {
        extractSub.remove();
      }

      // Delete cached zip immediately to free space
      try {
        await NspNativeOps.deleteFiles([cachedZipPath]);
      } catch {}
    }

    if (allExtractedFiles.length === 0) {
      throw new Error(
        `No files were extracted from ${zipFiles.length} zips. Errors: ${errors.join("; ")}`
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

    // Delete original zip files from SAF folder
    for (const zip of zipFiles) {
      try {
        await NspNativeOps.deleteSafDocument(zip.uri);
      } catch (e: any) {
        errors.push(`Could not delete original zip ${zip.name}: ${e.message}`);
      }
    }

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
