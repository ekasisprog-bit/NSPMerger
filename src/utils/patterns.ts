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
    getOutputName: (baseName) => `${baseName}.nsp`,
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
    // 00, 01, 02 (bare numbered files)
    type: "bare_numbered",
    regex: /^(\d+)$/,
    getBaseName: (_m) => "__bare__",
    getIndex: (m) => parseInt(m[1], 10),
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

export function isZipFile(fileName: string): boolean {
  return /\.zip$/i.test(fileName);
}

export function isNspFile(fileName: string): boolean {
  return /\.nsp$/i.test(fileName);
}

export function isSplitPart(fileName: string): boolean {
  return matchPattern(fileName) !== null;
}
