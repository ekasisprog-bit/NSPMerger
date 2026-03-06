import NspNativeOps from "../../modules/nsp-native-ops";
import { ArchiveTask, FileEntry, FileGroup, ProcessingResult, ScanResult, StandaloneNsp } from "@/types";
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
    overallPercentage?: number;
  }) => void;
  onSetTasks: (tasks: ArchiveTask[]) => void;
  onTaskUpdate: (index: number, task: Partial<ArchiveTask>) => void;
  onLog: (message: string) => void;
  onScanComplete: (scanResult: ScanResult) => void;
  onError: (message: string) => void;
}

export class CancelledError extends Error {
  constructor() {
    super("Processing was cancelled");
    this.name = "CancelledError";
  }
}

export interface CancelHandle {
  cancelled: boolean;
}

function checkCancelled(handle: CancelHandle) {
  if (handle.cancelled) throw new CancelledError();
}

// Overall progress budget: 80% for extract loop, 20% for merge/copy-back/cleanup
const EXTRACT_WEIGHT = 0.8;
const MERGE_WEIGHT = 0.2;

function extractPhaseProgress(
  archiveIndex: number,
  totalArchives: number,
  phaseWeight: number
): number {
  if (totalArchives === 0) return 0;
  const completedFraction = archiveIndex / totalArchives;
  const currentFraction = phaseWeight / totalArchives;
  return Math.round((completedFraction + currentFraction) * EXTRACT_WEIGHT * 100);
}

function mergePhaseProgress(stepIndex: number, totalSteps: number): number {
  if (totalSteps === 0) return Math.round(EXTRACT_WEIGHT * 100);
  const base = EXTRACT_WEIGHT * 100;
  const mergeRange = MERGE_WEIGHT * 100;
  return Math.round(base + (stepIndex / totalSteps) * mergeRange);
}

export async function runPipeline(
  folderUri: string,
  callbacks: PipelineCallbacks,
  cancelHandle: CancelHandle = { cancelled: false }
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const mergedFiles: string[] = [];
  const standaloneFiles: string[] = [];
  const cacheDir = await NspNativeOps.getCacheDir();

  const log = (msg: string) => callbacks.onLog(msg);

  try {
    // Step 1: List files in the selected folder
    callbacks.onPhaseChange("copying");
    callbacks.onProgress({ currentFile: "Scanning folder..." });
    log("Scanning folder for archives...");

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

    log(`Found ${archiveFiles.length} archive(s):`);
    for (const a of archiveFiles) {
      log(`  ${a.name} (${formatBytesSimple(a.size)})`);
    }

    // Emit task list from pipeline's own listing
    callbacks.onSetTasks(
      archiveFiles.map((f) => ({ name: f.name, status: "pending" as const }))
    );

    callbacks.onProgress({
      currentFile: `Found ${archiveFiles.length} archive files`,
      totalFiles: archiveFiles.length,
      overallPercentage: 0,
    });

    // Step 2: Check disk space
    const freeSpace = await NspNativeOps.getFreeDiskSpace();
    const largestArchive = Math.max(...archiveFiles.map((f) => f.size));
    if (largestArchive > 0 && freeSpace < largestArchive * 2) {
      throw new Error(
        `Insufficient disk space. Need ~${formatBytesSimple(largestArchive * 2)} free, have ${formatBytesSimple(freeSpace)}.`
      );
    }

    // Step 3: Copy, extract, and group per-archive (ISOLATED)
    const allGroups: FileGroup[] = [];
    const allStandalones: StandaloneNsp[] = [];
    const allUnknown: string[] = [];
    const groupToArchive: number[] = []; // parallel to allGroups
    const totalArchives = archiveFiles.length;

    for (let i = 0; i < totalArchives; i++) {
      checkCancelled(cancelHandle);
      const archive = archiveFiles[i];
      const archiveIsRar = isRarFile(archive.name);

      log(`--- Archive ${i + 1}/${totalArchives}: ${archive.name} ---`);

      // --- Copy phase ---
      callbacks.onTaskUpdate(i, { status: "copying" });
      callbacks.onPhaseChange("copying");
      callbacks.onProgress({
        currentFile: `Copying ${archive.name}...`,
        fileIndex: i + 1,
        totalFiles: totalArchives,
        bytesProcessed: 0,
        totalBytes: archive.size,
        percentage: 0,
        overallPercentage: extractPhaseProgress(i, totalArchives, 0),
      });

      const copySub = NspNativeOps.addListener("onCopyProgress", (event) => {
        const phaseWeight = 0.25 * (event.percentage / 100);
        callbacks.onProgress({
          bytesProcessed: event.bytesCopied,
          totalBytes: event.totalBytes,
          percentage: event.percentage,
          currentFile: `Copying: ${event.fileName}`,
          overallPercentage: extractPhaseProgress(i, totalArchives, phaseWeight),
        });
      });

      let cachedPath: string;
      try {
        cachedPath = await NspNativeOps.copyToCache(archive.uri, archive.name, archive.size);
        log(`Copied to cache`);
      } catch (e: any) {
        copySub.remove();
        const msg = `Failed to copy ${archive.name}: ${e.message}`;
        errors.push(msg);
        log(`ERROR: ${msg}`);
        callbacks.onTaskUpdate(i, { status: "error", error: e.message });
        continue;
      }

      copySub.remove();
      checkCancelled(cancelHandle);

      // --- Extract phase ---
      callbacks.onTaskUpdate(i, { status: "extracting" });
      callbacks.onPhaseChange("extracting");
      callbacks.onProgress({
        currentFile: `Extracting ${archive.name}...`,
        percentage: 0,
        overallPercentage: extractPhaseProgress(i, totalArchives, 0.25),
      });

      const extractDir = `${cacheDir}/extract_${i}`;
      const archiveExtracted: FileEntry[] = [];

      const extractSub = NspNativeOps.addListener("onExtractProgress", (event) => {
        const phaseWeight = 0.25 + 0.5 * (event.percentage / 100);
        callbacks.onProgress({
          bytesProcessed: event.bytesExtracted,
          totalBytes: event.totalBytes,
          percentage: event.percentage,
          currentFile: `Extracting: ${event.currentEntry}`,
          overallPercentage: extractPhaseProgress(i, totalArchives, phaseWeight),
        });
      });

      try {
        const result = archiveIsRar
          ? await NspNativeOps.extractRar(cachedPath, extractDir)
          : await NspNativeOps.extractZip(cachedPath, extractDir);

        log(`Extracted ${result.extractedFiles.length} file(s):`);

        for (const filePath of result.extractedFiles) {
          const pathParts = filePath.split("/");
          const fileName = pathParts.pop() || filePath;
          // Include parent dir for bare-numbered files
          const parentDir = pathParts.pop() || "";
          const qualifiedName = /^\d+$/.test(fileName) && parentDir
            ? `${parentDir}/${fileName}`
            : fileName;

          log(`  ${qualifiedName}`);

          archiveExtracted.push({
            uri: filePath,
            name: qualifiedName,
            size: 0,
          });
        }
      } catch (e: any) {
        const msg = `Failed to extract ${archive.name}: ${e.message}`;
        errors.push(msg);
        log(`ERROR: ${msg}`);
        callbacks.onTaskUpdate(i, { status: "error", error: e.message });
        extractSub.remove();
        try { await NspNativeOps.deleteFiles([cachedPath]); } catch {}
        continue;
      } finally {
        extractSub.remove();
      }

      // Delete cached archive to free space
      try {
        await NspNativeOps.deleteFiles([cachedPath]);
      } catch {}

      // --- Group phase ---
      callbacks.onTaskUpdate(i, { status: "grouping" });
      callbacks.onProgress({
        overallPercentage: extractPhaseProgress(i, totalArchives, 0.75),
      });

      const archiveScan = groupFiles(archiveExtracted);
      const archiveBase = archive.name.replace(/\.(zip|rar)$/i, "");

      // Fix bare_numbered output name: prefix with archive name
      for (const group of archiveScan.groups) {
        if (group.patternType === "bare_numbered") {
          group.outputName = `${archiveBase}.nsp`;
        }
      }

      // Log grouping results
      if (archiveScan.groups.length > 0) {
        for (const g of archiveScan.groups) {
          const hdrNote = g.parts[0]?.index === -1 ? " (includes .hdr)" : "";
          log(`  MERGE GROUP: ${g.parts.length} parts -> ${g.outputName} [${g.patternType}]${hdrNote}`);
          for (const p of g.parts) {
            log(`    part ${p.index}: ${p.name}`);
          }
        }
      }
      if (archiveScan.standaloneNsps.length > 0) {
        log(`  STANDALONE: ${archiveScan.standaloneNsps.map((n) => n.name).join(", ")}`);
      }
      if (archiveScan.unknownFiles.length > 0) {
        log(`  UNKNOWN (skipped): ${archiveScan.unknownFiles.join(", ")}`);
      }

      callbacks.onTaskUpdate(i, {
        status: "pending", // stays pending until merge/copy completes
        groupsFound: archiveScan.groups.length,
        standalonesFound: archiveScan.standaloneNsps.length,
      });

      for (const _group of archiveScan.groups) {
        groupToArchive.push(i);
      }

      allGroups.push(...archiveScan.groups);
      allStandalones.push(...archiveScan.standaloneNsps);
      allUnknown.push(...archiveScan.unknownFiles);

      callbacks.onProgress({
        overallPercentage: extractPhaseProgress(i + 1, totalArchives, 0),
      });
    }

    // Deduplicate output names across all groups
    deduplicateOutputNames(allGroups);

    if (allGroups.length === 0 && allStandalones.length === 0) {
      throw new Error(
        `No NSP parts or standalone NSPs found in any of the ${totalArchives} archives.`
      );
    }

    // Step 4: Dispatch scan result
    const scanResult: ScanResult = {
      groups: allGroups,
      standaloneNsps: allStandalones,
      unknownFiles: allUnknown,
    };

    callbacks.onPhaseChange("scanning");
    callbacks.onProgress({
      currentFile: `Found ${scanResult.groups.length} merge groups, ${scanResult.standaloneNsps.length} standalone NSPs`,
    });
    callbacks.onScanComplete(scanResult);

    log(`--- PLAN ---`);
    if (allGroups.length > 0) {
      log(`Merge ${allGroups.length} group(s):`);
      for (const g of allGroups) {
        log(`  ${g.parts.length} parts -> ${g.outputName}`);
      }
    }
    if (allStandalones.length > 0) {
      log(`Copy ${allStandalones.length} standalone NSP(s):`);
      for (const n of allStandalones) {
        log(`  ${n.name}`);
      }
    }

    // Total merge+copy steps for overall progress
    const totalMergeSteps = scanResult.groups.length + scanResult.standaloneNsps.length + 1;

    // Step 5: Merge each group
    if (scanResult.groups.length > 0) {
      callbacks.onPhaseChange("merging");
      callbacks.onProgress({
        totalFiles: scanResult.groups.length,
        currentFile: `Merging ${scanResult.groups.length} groups...`,
      });

      for (let i = 0; i < scanResult.groups.length; i++) {
        checkCancelled(cancelHandle);
        const group = scanResult.groups[i];
        const archiveIdx = groupToArchive[i];

        callbacks.onTaskUpdate(archiveIdx, { status: "merging" });
        log(`Merging: ${group.outputName} (${group.parts.length} parts)...`);

        callbacks.onProgress({
          currentFile: `Merging: ${group.outputName}`,
          fileIndex: i + 1,
          percentage: 0,
          overallPercentage: mergePhaseProgress(i, totalMergeSteps),
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

          // Validate PFS0 magic for NSP outputs
          if (group.outputName.toLowerCase().endsWith(".nsp")) {
            try {
              const isValid = await NspNativeOps.validatePfs0Magic(outputPath);
              if (isValid) {
                log(`  PFS0 header OK`);
              } else {
                log(`  WARNING: No PFS0 header! Output may be corrupt.`);
                errors.push(`${group.outputName}: merged file has no PFS0 header — may be corrupt`);
              }
            } catch {
              // validatePfs0Magic not available, skip validation
            }
          }

          // Copy merged file back to the source folder via SAF
          callbacks.onTaskUpdate(archiveIdx, { status: "copying_back" });
          await NspNativeOps.copyFromCache(outputPath, folderUri, group.outputName);
          mergedFiles.push(group.outputName);
          log(`  Saved: ${group.outputName}`);

          // Delete merged cache file
          await NspNativeOps.deleteFiles([outputPath]);
        } catch (e: any) {
          const msg = `Failed to merge ${group.outputName}: ${e.message}`;
          errors.push(msg);
          log(`  ERROR: ${msg}`);
          callbacks.onTaskUpdate(archiveIdx, { status: "error", error: e.message });
        } finally {
          mergeSub.remove();
        }

        // Delete source parts
        try {
          const partPaths = group.parts.map((p) => p.uri);
          await NspNativeOps.deleteFiles(partPaths);
        } catch {}

        // Mark archive done if all its groups are processed
        const allDone = scanResult.groups
          .every((g, gi) => groupToArchive[gi] !== archiveIdx || gi <= i);
        if (allDone) {
          callbacks.onTaskUpdate(archiveIdx, { status: "done" });
        }
      }
    }

    // Mark archives without groups as done
    const archivesWithGroups = new Set(groupToArchive);
    for (let i = 0; i < totalArchives; i++) {
      if (!archivesWithGroups.has(i)) {
        callbacks.onTaskUpdate(i, { status: "done" });
      }
    }

    // Step 6: Move standalone NSPs back to SAF folder
    for (let si = 0; si < scanResult.standaloneNsps.length; si++) {
      const nsp = scanResult.standaloneNsps[si];
      log(`Copying standalone: ${nsp.name}`);
      callbacks.onProgress({
        currentFile: `Copying: ${nsp.name}`,
        overallPercentage: mergePhaseProgress(
          scanResult.groups.length + si,
          totalMergeSteps
        ),
      });
      try {
        await NspNativeOps.copyFromCache(nsp.uri, folderUri, nsp.name);
        standaloneFiles.push(nsp.name);
        log(`  Saved: ${nsp.name}`);
      } catch (e: any) {
        const msg = `Failed to copy standalone ${nsp.name}: ${e.message}`;
        errors.push(msg);
        log(`  ERROR: ${msg}`);
      }
    }

    // Step 7: Cleanup
    log(`Cleaning up cache...`);
    callbacks.onPhaseChange("cleanup");
    callbacks.onProgress({
      currentFile: "Cleaning up cache...",
      overallPercentage: mergePhaseProgress(totalMergeSteps - 1, totalMergeSteps),
    });
    try {
      await NspNativeOps.deleteFiles([cacheDir]);
    } catch {}
    log(`Done!`);

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
    try {
      await NspNativeOps.deleteFiles([cacheDir]);
    } catch {}

    throw e;
  }
}

function deduplicateOutputNames(groups: FileGroup[]): void {
  const seen = new Map<string, number>();
  for (const group of groups) {
    const name = group.outputName;
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    if (count > 1) {
      const ext = name.lastIndexOf(".");
      if (ext > 0) {
        group.outputName = `${name.slice(0, ext)} (${count})${name.slice(ext)}`;
      } else {
        group.outputName = `${name} (${count})`;
      }
    }
  }
}

function formatBytesSimple(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}
