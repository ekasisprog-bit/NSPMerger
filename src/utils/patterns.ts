import { PatternType } from "@/types";

interface PatternMatch {
  baseName: string;
  index: number;
  patternType: PatternType;
}

const PATTERNS: Array<{
  type: PatternType;
  regex: RegExp;
  getBaseName: (match: RegExpMatchArray) => string;
  getIndex: (match: RegExpMatchArray) => number;
  getOutputName: (baseName: string) => string;
}> = [
  {
    // game.ns0, game.ns1, game.ns2
    type: "ns_numbered",
    regex: /^(.+)\.ns(\d+)$/i,
    getBaseName: (m) => m[1],
    getIndex: (m) => parseInt(m[2], 10),
    getOutputName: (baseName) => `${baseName}.nsp`,
  },
  {
    // game.nsp.00, game.nsp.01
    type: "nsp_dotted",
    regex: /^(.+\.nsp)\.(\d+)$/i,
    getBaseName: (m) => m[1],
    getIndex: (m) => parseInt(m[2], 10),
    getOutputName: (baseName) => baseName,
  },
  {
    // game.xc0, game.xc1
    type: "xc_numbered",
    regex: /^(.+)\.xc(\d+)$/i,
    getBaseName: (m) => m[1],
    getIndex: (m) => parseInt(m[2], 10),
    getOutputName: (baseName) => `${baseName}.xci`,
  },
  {
    // game.xci.00, game.xci.01
    type: "xci_dotted",
    regex: /^(.+\.xci)\.(\d+)$/i,
    getBaseName: (m) => m[1],
    getIndex: (m) => parseInt(m[2], 10),
    getOutputName: (baseName) => baseName,
  },
  {
    // game.nsp.part0, game.nsp.part1
    type: "nsp_part",
    regex: /^(.+\.nsp)\.part(\d+)$/i,
    getBaseName: (m) => m[1],
    getIndex: (m) => parseInt(m[2], 10),
    getOutputName: (baseName) => baseName,
  },
  {
    // parentDir/00, parentDir/01 (bare numbered files, qualified by parent)
    type: "bare_numbered",
    regex: /^(?:(.+)\/)?(\d+)$/,
    getBaseName: (m) => m[1] || "__bare__",
    getIndex: (m) => parseInt(m[2], 10),
    getOutputName: (_baseName) => "merged.nsp",
  },
];

export function matchPattern(fileName: string): PatternMatch | null {
  for (const pattern of PATTERNS) {
    const match = fileName.match(pattern.regex);
    if (match) {
      return {
        baseName: pattern.getBaseName(match),
        index: pattern.getIndex(match),
        patternType: pattern.type,
      };
    }
  }
  return null;
}

export function getOutputName(baseName: string, patternType: PatternType): string {
  const pattern = PATTERNS.find((p) => p.type === patternType);
  return pattern ? pattern.getOutputName(baseName) : `${baseName}.nsp`;
}

/**
 * Check if a filename is a .nsp.hdr header file (nxdumptool non-concatenation mode).
 * Returns the baseName (e.g., "game.nsp") if it matches, null otherwise.
 */
export function matchHdrFile(fileName: string): string | null {
  const match = fileName.match(/^(.+\.nsp)\.hdr$/i);
  return match ? match[1] : null;
}

export function isZipFile(fileName: string): boolean {
  return /\.zip$/i.test(fileName);
}

export function isRarFile(fileName: string): boolean {
  return /\.rar$/i.test(fileName);
}

export function isArchiveFile(fileName: string): boolean {
  return isZipFile(fileName) || isRarFile(fileName);
}

export function isNspFile(fileName: string): boolean {
  return /\.nsp$/i.test(fileName);
}

export function isSplitPart(fileName: string): boolean {
  return matchPattern(fileName) !== null;
}
