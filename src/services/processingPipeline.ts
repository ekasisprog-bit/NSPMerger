import NspNativeOps from "../../modules/nsp-native-ops";
import { FileEntry, FileGroup, ProcessingResult, ScanResult } from "@/types";
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
  const cacheDir = NspNativeOps.getCacheDir();

  try {
    // ── Step 1: List files in the selected folder ──
    callbacks.onPhaseChange("copying");
    const allFiles = await NspNativeOps.listDirectoryFiles(folderUri);
    const zipFiles = allFiles.filter((f) => isZipFile(f.name));

    if (zipFiles.length === 0) {
      throw new Error("No zip files found in the selected folder.");
    }

    // ── Step 2: Check disk space ──
    const totalZipSize = zipFiles.reduce((sum, f) => sum + f.size, 0);
    const freeSpace = NspNativeOps.getFreeDiskSpace();
    // Need roughly 2x largest zip for headroom
    const largestZip = Math.max(...zipFiles.map((f) => f.size));
    if (freeSpace < largestZip * 2) {
      throw new Error(
        `Insufficient disk space. Need ~${formatBytesSimple(largestZip * 2)} free, have ${formatBytesSimple(freeSpace)}.`
      );
    }

    // ── Step 3: Copy zips to cache & extract ──
    callbacks.onProgress({ totalFiles: zipFiles.length });

    const allExtractedFiles: FileEntry[] = [];

    for (let i = 0; i < zipFiles.length; i++) {
      const zip = zipFiles[i];
      callbacks.onProgress({
        currentFile: zip.name,
        fileIndex: i + 1,
        percentage: 0,
      });

      // Copy zip to cache
      callbacks.onPhaseChange("copying");
      const cachedZipPath = await NspNativeOps.copyToCache(zip.uri, zip.name);

      // Extract zip
      callbacks.onPhaseChange("extracting");
      const extractDir = `${cacheDir}/extract_${i}`;

      // Set up progress listener for extraction
      const extractSub = NspNativeOps.addListener("onExtractProgress", (event) => {
        callbacks.onProgress({
          bytesProcessed: event.bytesExtracted,
          totalBytes: event.totalBytes,
          percentage: event.percentage,
          currentFile: `${zip.name} → ${event.currentEntry}`,
        });
      });

      try {
        const result = await NspNativeOps.extractZip(cachedZipPath, extractDir);

        // Collect extracted files as FileEntry objects
        for (const filePath of result.extractedFiles) {
          const fileName = filePath.split("/").pop() || filePath;
          allExtractedFiles.push({
            uri: filePath,
            name: fileName,
            size: 0, // Size will be read from filesystem during merge
          });
        }
      } catch (e: any) {
        errors.push(`Failed to extract ${zip.name}: ${e.message}`);
      } finally {
        extractSub.remove();
      }

      // Delete cached zip immediately to free space
      await NspNativeOps.deleteFiles([cachedZipPath]);
    }

    // ── Step 4: Scan & Group extracted files ──
    callbacks.onPhaseChange("scanning");
    const scanResult: ScanResult = groupFiles(allExtractedFiles);

    callbacks.onProgress({
      currentFile: `Found ${scanResult.groups.length} groups, ${scanResult.standaloneNsps.length} standalone`,
    });

    // ── Step 5: Merge each group ──
    callbacks.onPhaseChange("merging");
    callbacks.onProgress({
      totalFiles: scanResult.groups.length,
    });

    for (let i = 0; i < scanResult.groups.length; i++) {
      const group = scanResult.groups[i];
      callbacks.onProgress({
        currentFile: group.outputName,
        fileIndex: i + 1,
        percentage: 0,
      });

      const outputPath = `${cacheDir}/${group.outputName}`;

      const mergeSub = NspNativeOps.addListener("onMergeProgress", (event) => {
        callbacks.onProgress({
          bytesProcessed: event.bytesWritten,
          totalBytes: event.totalBytes,
          percentage: event.percentage,
          currentFile: `${group.outputName} (${event.currentPart})`,
        });
      });

      try {
        // Merge parts (they're already local filesystem paths from extraction)
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
      const partPaths = group.parts.map((p) => p.uri);
      await NspNativeOps.deleteFiles(partPaths);
    }

    // ── Step 6: Move standalone NSPs back ──
    for (const nsp of scanResult.standaloneNsps) {
      try {
        await NspNativeOps.copyFromCache(nsp.uri, folderUri, nsp.name);
        standaloneFiles.push(nsp.name);
      } catch (e: any) {
        errors.push(`Failed to copy standalone ${nsp.name}: ${e.message}`);
      }
    }

    // ── Step 7: Cleanup ──
    callbacks.onPhaseChange("cleanup");
    await NspNativeOps.deleteFiles([cacheDir]);

    // Delete original zip files from SAF folder
    for (const zip of zipFiles) {
      try {
        await NspNativeOps.deleteSafDocument(zip.uri);
      } catch (e: any) {
        // Non-critical: original zips can be manually deleted
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
