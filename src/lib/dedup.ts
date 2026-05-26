import type { WikiPage } from "./types.js";

export interface DedupMatch {
  newTitle: string;
  existingTitle: string;
  existingPath: string;
  score: number;       // 0-1
  reasons: string[];
  action: "merge" | "skip" | "review";
}

/**
 * Three-stage dedup: exact → fuzzy → LLM.
 * Stages 1 & 2 are local (no LLM). Stage 3 is optional.
 */
export function dedupScan(newPages: WikiPage[], existingPages: WikiPage[]): DedupMatch[] {
  const matches: DedupMatch[] = [];

  for (const np of newPages) {
    // Stage 1: Exact title match
    const exact = existingPages.find(ep =>
      ep.title.toLowerCase() === np.title.toLowerCase() ||
      ep.aliases.some(a => a.toLowerCase() === np.title.toLowerCase()) ||
      np.aliases.some(a => a.toLowerCase() === ep.title.toLowerCase())
    );
    if (exact) {
      matches.push({
        newTitle: np.title,
        existingTitle: exact.title,
        existingPath: exact.filePath,
        score: 1.0,
        reasons: ["exact title match"],
        action: "skip",
      });
      continue;
    }

    // Stage 2: Fuzzy match (normalized edit distance + token overlap)
    let bestMatch: { page: WikiPage; score: number; reasons: string[] } | null = null;

    for (const ep of existingPages) {
      const { score, reasons } = fuzzyScore(np.title, ep.title, np.tags, ep.tags);
      if (score >= 0.6 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { page: ep, score, reasons };
      }
    }

    if (bestMatch) {
      matches.push({
        newTitle: np.title,
        existingTitle: bestMatch.page.title,
        existingPath: bestMatch.page.filePath,
        score: bestMatch.score,
        reasons: bestMatch.reasons,
        action: bestMatch.score >= 0.9 ? "skip" : "review",
      });
    }
  }

  return matches;
}

/** Fuzzy similarity score between two titles */
function fuzzyScore(a: string, b: string, tagsA: string[], tagsB: string[]): { score: number; reasons: string[] } {
  const na = normalize(a);
  const nb = normalize(b);
  const reasons: string[] = [];
  let score = 0;

  // Exact normalized match
  if (na === nb) return { score: 1.0, reasons: ["normalized exact match"] };

  // Token overlap (Jaccard)
  const tokA = new Set(na.split(/\s+/));
  const tokB = new Set(nb.split(/\s+/));
  const intersection = [...tokA].filter(t => tokB.has(t));
  const union = new Set([...tokA, ...tokB]);
  const jaccard = intersection.length / union.size;
  if (jaccard > 0) {
    score += jaccard * 0.6;
    reasons.push(`token overlap: ${(jaccard * 100).toFixed(0)}%`);
  }

  // Edit distance (Levenshtein, normalized)
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen > 0) {
    const editDist = levenshtein(na, nb);
    const editSim = 1 - editDist / maxLen;
    if (editSim > 0.6) {
      score += editSim * 0.3;
      reasons.push(`edit similarity: ${(editSim * 100).toFixed(0)}%`);
    }
  }

  // Shared tags
  const sharedTags = tagsA.filter(t => tagsB.includes(t));
  if (sharedTags.length > 0) {
    score += Math.min(sharedTags.length * 0.1, 0.2);
    reasons.push(`shared tags: ${sharedTags.join(", ")}`);
  }

  return { score: Math.min(score, 1), reasons };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}
