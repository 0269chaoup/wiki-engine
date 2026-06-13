/**
 * @file 搜索模块
 *
 * 基于 VaultReader 的本地 fuzzy search，支持多维度过滤和加权评分。
 * Phase 1：纯本地，无 LLM 依赖。
 */

import type { WikiPage, PageType } from "./types.js";

/** 搜索选项接口 */
export interface SearchOptions {
  /** 按类型过滤（concept/entity/event/story/wiki/source） */
  type?: PageType;
  /** 按知识域过滤 */
  domain?: string;
  /** 按标签过滤 */
  tag?: string;
  /** 按状态过滤 */
  status?: string;
  /** 搜索层级：exact（仅标题/别名）、fuzzy（默认，加权评分）、content（含正文全文） */
  level?: "exact" | "fuzzy" | "content";
  /** 最大返回数量 */
  top?: number;
}

/** 搜索结果接口 */
export interface SearchResult {
  /** 匹配的页面 */
  page: WikiPage;
  /** 匹配评分 */
  score: number;
  /** 匹配原因列表 */
  reasons: string[];
}

/**
 * 在 vault 页面列表中搜索
 *
 * @param query - 搜索关键词
 * @param pages - vault 中的所有页面
 * @param opts - 搜索选项
 * @returns 按评分降序排列的搜索结果
 */
export function searchVault(
  query: string,
  pages: WikiPage[],
  opts: SearchOptions = {}
): SearchResult[] {
  const level = opts.level ?? "fuzzy";
  const top = opts.top ?? 20;
  const nq = normalize(query);

  if (!nq) return [];

  let results: SearchResult[] = [];

  for (const page of pages) {
    // ── 过滤 ──
    if (opts.type && page.type !== opts.type) continue;
    if (opts.domain && page.domain !== opts.domain) continue;
    if (opts.tag && !page.tags.some(t => normalize(t).includes(normalize(opts.tag!)))) continue;
    if (opts.status && page.status !== opts.status) continue;

    // ── 评分 ──
    const { score, reasons } = computeScore(nq, page, level);
    if (score > 0) {
      results.push({ page, score, reasons });
    }
  }

  // 按评分降序排列，取 top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, top);
}

/**
 * 计算单个页面与查询的匹配评分
 *
 * 评分权重：
 *   title 精确包含: +10
 *   title 归一化匹配: +8
 *   alias 匹配: +8（每个 +4，上限 8）
 *   tag 匹配: +5（每个 +2，上限 5）
 *   domain 精确匹配: +3
 *   status 精确匹配: +2
 *   content 匹配: 每次 +1.5，上限 9（仅 level=content 或 fuzzy）
 */
function computeScore(
  nq: string,
  page: WikiPage,
  level: "exact" | "fuzzy" | "content"
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const ntitle = normalize(page.title);

  // ── Title 匹配 ──
  if (ntitle === nq) {
    score += 10;
    reasons.push("title exact");
  } else if (ntitle.includes(nq)) {
    score += 8;
    reasons.push("title contains");
  } else if (level !== "exact") {
    // fuzzy: token overlap
    const overlap = tokenOverlap(nq, ntitle);
    if (overlap >= 0.5) {
      score += 6 * overlap;
      reasons.push(`title token overlap ${(overlap * 100).toFixed(0)}%`);
    }
  }

  // ── Alias 匹配 ──
  if (page.aliases.length > 0) {
    let aliasScore = 0;
    for (const alias of page.aliases) {
      const na = normalize(alias);
      if (na === nq || na.includes(nq)) {
        aliasScore += 4;
      }
    }
    aliasScore = Math.min(aliasScore, 8);
    if (aliasScore > 0) {
      score += aliasScore;
      reasons.push(`alias match (+${aliasScore})`);
    }
  }

  // ── Tag 匹配 ──
  if (page.tags.length > 0 && level !== "exact") {
    let tagScore = 0;
    for (const tag of page.tags) {
      const nt = normalize(tag);
      if (nt.includes(nq) || nq.includes(nt)) {
        tagScore += 2;
      }
    }
    tagScore = Math.min(tagScore, 5);
    if (tagScore > 0) {
      score += tagScore;
      reasons.push(`tag match (+${tagScore})`);
    }
  }

  // ── Domain 匹配 ──
  if (page.domain && level !== "exact") {
    const nd = normalize(page.domain);
    if (nd.includes(nq) || nq.includes(nd)) {
      score += 3;
      reasons.push("domain match");
    }
  }

  // ── Status 匹配 ──
  if (page.status && level !== "exact") {
    const ns = normalize(page.status);
    if (ns.includes(nq)) {
      score += 2;
      reasons.push("status match");
    }
  }

  // ── Content 匹配（level=content 或 level=fuzzy）──
  if (level === "content" || level === "fuzzy") {
    const nc = normalize(page.content);
    const count = countOccurrences(nc, nq);
    if (count > 0) {
      const contentScore = Math.min(count * 1.5, 9);
      score += contentScore;
      reasons.push(`content ×${count} (+${contentScore})`);
    }
  }

  return { score, reasons };
}

/**
 * 字符串归一化：小写 → 去标点 → 合并空白
 */
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * 计算两个归一化字符串的 token Jaccard 重叠度
 */
function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(a.split(/\s+/));
  const tokB = new Set(b.split(/\s+/));
  const intersection = [...tokA].filter(t => tokB.has(t));
  const union = new Set([...tokA, ...tokB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

/**
 * 计算子串在文本中出现的次数（非重叠匹配）
 */
function countOccurrences(text: string, query: string): number {
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = text.indexOf(query, pos);
    if (idx === -1) break;
    count++;
    pos = idx + query.length;
  }
  return count;
}
