/**
 * @file 三阶段去重模块
 *
 * 实现了页面去重的三阶段扫描：
 * 1. 精确匹配：标题完全一致（含别名）
 * 2. 模糊匹配：基于归一化编辑距离 + token 重叠 + 标签共享
 * 3. LLM 仲裁：（可选，由外部调用者实现）
 *
 * 前两个阶段为纯本地计算，不需要 LLM。
 */

import type { WikiPage } from "./types.js";

/**
 * 去重匹配结果接口
 * 表示两个页面之间的重复匹配关系
 */
export interface DedupMatch {
  /** 新页面标题 */
  newTitle: string;
  /** 已有页面标题 */
  existingTitle: string;
  /** 已有页面的文件路径 */
  existingPath: string;
  /** 匹配置信度评分（0-1） */
  score: number;
  /** 匹配原因列表 */
  reasons: string[];
  /** 建议操作：merge（合并）、skip（跳过）、review（人工审核） */
  action: "merge" | "skip" | "review";
}

/**
 * 三阶段去重扫描
 *
 * 对新页面列表与已有页面列表进行去重比对：
 * - Stage 1：精确标题匹配（含别名交叉匹配）
 * - Stage 2：模糊匹配（归一化编辑距离 + token Jaccard 重叠 + 标签共享）
 * - Stage 3：LLM 仲裁（可选，由外部调用者实现）
 *
 * @param newPages - 待检查的新页面列表
 * @param existingPages - 已有的页面列表
 * @returns 去重匹配结果列表
 */
export function dedupScan(newPages: WikiPage[], existingPages: WikiPage[]): DedupMatch[] {
  const matches: DedupMatch[] = [];

  for (const np of newPages) {
    /** Stage 1：精确标题匹配 */
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

    /** Stage 2：模糊匹配（阈值 0.6） */
    let bestMatch: { page: WikiPage; score: number; reasons: string[] } | null = null;

    for (const ep of existingPages) {
      const { score, reasons } = fuzzyScore(np.title, ep.title, np.tags, ep.tags);
      /** 只保留评分 ≥ 0.6 且最高的匹配 */
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
        /** 评分 ≥ 0.9 视为高度重复，建议跳过；否则建议人工审核 */
        action: bestMatch.score >= 0.9 ? "skip" : "review",
      });
    }
  }

  return matches;
}

/**
 * 计算两个标题之间的模糊相似度评分
 *
 * 综合三个因素：
 * 1. Token Jaccard 重叠（权重 0.6）
 * 2. 归一化编辑距离（权重 0.3）
 * 3. 共享标签（每个 +0.1，上限 0.2）
 *
 * 导出供 stage2-align 模块复用。
 *
 * @param a - 标题 A
 * @param b - 标题 B
 * @param tagsA - 标题 A 的标签列表
 * @param tagsB - 标题 B 的标签列表
 * @returns 评分和原因列表
 */
export function fuzzyScore(a: string, b: string, tagsA: string[], tagsB: string[]): { score: number; reasons: string[] } {
  /** 归一化标题（小写化、去除特殊字符） */
  const na = normalize(a);
  const nb = normalize(b);
  const reasons: string[] = [];
  let score = 0;

  /** 归一化后完全匹配 */
  if (na === nb) return { score: 1.0, reasons: ["normalized exact match"] };

  /** 因素 1：Token Jaccard 相似度 */
  const tokA = new Set(na.split(/\s+/));
  const tokB = new Set(nb.split(/\s+/));
  const intersection = [...tokA].filter(t => tokB.has(t));
  const union = new Set([...tokA, ...tokB]);
  const jaccard = intersection.length / union.size;
  if (jaccard > 0) {
    score += jaccard * 0.6;
    reasons.push(`token overlap: ${(jaccard * 100).toFixed(0)}%`);
  }

  /** 因素 2：编辑距离（Levenshtein）归一化相似度 */
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen > 0) {
    const editDist = levenshtein(na, nb);
    const editSim = 1 - editDist / maxLen;
    if (editSim > 0.6) {
      score += editSim * 0.3;
      reasons.push(`edit similarity: ${(editSim * 100).toFixed(0)}%`);
    }
  }

  /** 因素 3：共享标签 */
  const sharedTags = tagsA.filter(t => tagsB.includes(t));
  if (sharedTags.length > 0) {
    score += Math.min(sharedTags.length * 0.1, 0.2);
    reasons.push(`shared tags: ${sharedTags.join(", ")}`);
  }

  return { score: Math.min(score, 1), reasons };
}

/**
 * 字符串归一化
 * 转小写 → 去除标点符号 → 合并空白 → 去除首尾空白
 * @param s - 输入字符串
 * @returns 归一化后的字符串
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * 计算两个字符串之间的 Levenshtein 编辑距离
 *
 * 使用动态规划算法，时间复杂度 O(m*n)。
 *
 * @param a - 字符串 A
 * @param b - 字符串 B
 * @returns 编辑距离（插入、删除、替换的最小操作数）
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  /** 初始化 DP 表 */
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  /** 边界条件：空字符串到目标字符串的距离 */
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  /** 填充 DP 表 */
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        /** 删除 */
        dp[i][j - 1] + 1,        /** 插入 */
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)  /** 替换（字符相同则无需操作） */
      );
    }
  }
  return dp[m][n];
}
