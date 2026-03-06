import { FileEntry, FileGroup, FilePart, ScanResult, StandaloneNsp } from "@/types";
import { matchPattern, getOutputName, isNspFile, matchHdrFile } from "@/utils/patterns";

export function groupFiles(files: FileEntry[]): ScanResult {
  const groups = new Map<string, FilePart[]>();
  const groupPatterns = new Map<string, ReturnType<typeof matchPattern>>();
  const standaloneNsps: StandaloneNsp[] = [];
  const unknownFiles: string[] = [];

  // Track .nsp.hdr files separately — they need to be prepended to nsp_dotted groups
  const hdrFiles = new Map<string, FileEntry>(); // baseName -> FileEntry

  for (const file of files) {
    // Check for .nsp.hdr first
    const hdrBaseName = matchHdrFile(file.name);
    if (hdrBaseName) {
      hdrFiles.set(hdrBaseName.toLowerCase(), file);
      continue;
    }

    const match = matchPattern(file.name);

    if (match) {
      const key = `${match.patternType}:${match.baseName}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupPatterns.set(key, match);
      }
      groups.get(key)!.push({
        uri: file.uri,
        name: file.name,
        size: file.size,
        index: match.index,
      });
    } else if (isNspFile(file.name)) {
      standaloneNsps.push({
        uri: file.uri,
        name: file.name,
        size: file.size,
      });
    } else {
      unknownFiles.push(file.name);
    }
  }

  const fileGroups: FileGroup[] = [];

  for (const [key, parts] of groups) {
    const pattern = groupPatterns.get(key)!;

    // Sort parts by index
    parts.sort((a, b) => a.index - b.index);

    // Validate sequential numbering (0, 1, 2, ...)
    const indices = parts.map((p) => p.index);
    const hasGaps = indices.some((idx, i) => i > 0 && idx !== indices[i - 1] + 1);
    const startsFromZero = indices[0] === 0;

    if (hasGaps || !startsFromZero) {
      // Skip groups with missing parts — merging would produce corrupt output
      unknownFiles.push(
        ...parts.map((p) => `${p.name} (skipped: incomplete set, indices: ${indices.join(",")})`)
      );
      continue;
    }

    // For nsp_dotted groups, check if there's a matching .hdr file to prepend
    if (pattern.patternType === "nsp_dotted") {
      const hdrKey = pattern.baseName.toLowerCase();
      const hdrFile = hdrFiles.get(hdrKey);
      if (hdrFile) {
        // Prepend header as the very first part (before index 0)
        parts.unshift({
          uri: hdrFile.uri,
          name: hdrFile.name,
          size: hdrFile.size,
          index: -1, // marker only, already in position 0
        });
        hdrFiles.delete(hdrKey); // consumed
      }
    }

    const outputName = getOutputName(pattern.baseName, pattern.patternType);

    fileGroups.push({
      baseName: pattern.baseName,
      outputName,
      parts,
      totalSize: parts.reduce((sum, p) => sum + p.size, 0),
      patternType: pattern.patternType,
    });
  }

  // Any leftover .hdr files with no matching group go to unknown
  for (const [baseName, hdrFile] of hdrFiles) {
    unknownFiles.push(`${hdrFile.name} (no matching .nsp.XX parts for ${baseName})`);
  }

  // Sort groups by name for consistent ordering
  fileGroups.sort((a, b) => a.baseName.localeCompare(b.baseName));

  return {
    groups: fileGroups,
    standaloneNsps,
    unknownFiles,
  };
}
