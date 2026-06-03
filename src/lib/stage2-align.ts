/**
 * @file Stage 2: Vault 对齐模块
 *
 * 将提取的实体/事件与 vault 中的现有内容进行对齐。
 * 对每个条目做出决策：创建新页面 / 合并到已有页面 / 重命名。
 *
 * 使用去重模块中的 fuzzyScore 函数进行模糊匹配。
 *
 * 对齐逻辑：
 * 1. 精确匹配：标题或别名完全一致 → 合并
 * 2. 高相似度匹配（≥0.9）：合并到已有页面
 * 3. 中等相似度匹配（0.6-0.9）：标记为冲突，需要人工/LLM 仲裁
 * 4. 无匹配：创建新页面
 */

import type { ExtractedEntity, ExtractedEvent, AlignedExtraction, AlignmentAction, AlignmentConflict, VaultIndex, VaultIndexEntry } from "./types.js";
import type { WikiPage } from "./types.js";
import type { VaultReader } from "./vault.js";
import { fuzzyScore } from "./dedup.js";

/**
 * 将提取结果与 vault 现有内容对齐
 *
 * @param entities - 提取的实体列表
 * @param events - 提取的事件列表
 * @param vault - Vault 读取器实例
 * @returns 对齐后的提取结果（包含操作决策和冲突列表）
 */
export async function alignToVault(
  entities: ExtractedEntity[],
  events: ExtractedEvent[],
  vault: VaultReader,
): Promise<AlignedExtraction> {
  /** 构建 vault 索引（标题/别名/标签/类型/路径） */
  const index = await buildVaultIndex(vault);

  const actions: AlignmentAction[] = [];
  const conflicts: AlignmentConflict[] = [];
  const alignedItems: ExtractedEntity[] = [];

  for (const entity of entities) {
    /** 对每个实体执行对齐匹配 */
    const result = alignItem(entity.name, entity.tags, index);

    switch (result.action) {
      case "exact_match":
        /** 精确匹配：已有同名页面，标记为合并 */
        actions.push({
          item_name: entity.name,
          action: "merge",
          target_existing: result.match!.path,
          resolved_name: entity.name,
          reason: `精确匹配已有页面: ${result.match!.title}`,
        });
        alignedItems.push(entity);
        break;

      case "fuzzy_match_high":
        /** 高相似度匹配（≥0.9）：合并到已有页面，使用已有页面的标题 */
        actions.push({
          item_name: entity.name,
          action: "merge",
          target_existing: result.match!.path,
          resolved_name: result.match!.title,
          reason: `高度相似 (${(result.score! * 100).toFixed(0)}%): ${result.match!.title}`,
        });
        /** 覆盖名称以匹配已有页面 */
        alignedItems.push({ ...entity, name: result.match!.title });
        break;

      case "fuzzy_match_medium":
        /** 中等相似度匹配（0.6-0.9）：标记为冲突，需要仲裁 */
        conflicts.push({
          new_name: entity.name,
          candidates: [{ title: result.match!.title, path: result.match!.path, score: result.score! }],
          reason: `模糊匹配 (${(result.score! * 100).toFixed(0)}%): 需要判断是否同一事物`,
        });
        alignedItems.push(entity);
        break;

      case "no_match":
        /** 无匹配：创建新页面 */
        actions.push({
          item_name: entity.name,
          action: "create",
          resolved_name: entity.name,
          reason: "无匹配，创建新页面",
        });
        alignedItems.push(entity);
        break;
    }
  }

  return {
    items: alignedItems,
    events,
    actions,
    conflicts,
  };
}

/**
 * 对齐结果内部接口
 * 表示单个条目的对齐匹配结果
 */
interface AlignResult {
  /** 匹配动作类型 */
  action: "exact_match" | "fuzzy_match_high" | "fuzzy_match_medium" | "no_match";
  /** 匹配到的 vault 索引条目（可选） */
  match?: VaultIndexEntry;
  /** 模糊匹配评分（可选） */
  score?: number;
}

/**
 * 对单个条目执行对齐匹配
 *
 * 两阶段匹配：
 * 1. 精确匹配：标题或别名完全一致（不区分大小写）
 * 2. 模糊匹配：使用 fuzzyScore 计算相似度
 *
 * @param name - 条目名称
 * @param tags - 条目标签
 * @param index - vault 索引
 * @returns 对齐匹配结果
 */
function alignItem(name: string, tags: string[], index: VaultIndex): AlignResult {
  const nameLower = name.toLowerCase();

  /** Stage 1：精确标题/别名匹配 */
  for (const entry of index) {
    if (entry.title.toLowerCase() === nameLower) {
      return { action: "exact_match", match: entry };
    }
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === nameLower) {
        return { action: "exact_match", match: entry };
      }
    }
  }

  /** Stage 2：模糊匹配 */
  let best: { entry: VaultIndexEntry; score: number } | null = null;

  for (const entry of index) {
    const { score } = fuzzyScore(name, entry.title, tags, entry.tags);
    /** 只保留评分 ≥ 0.6 且最高的匹配 */
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { entry, score };
    }
  }

  if (best) {
    /** 评分 ≥ 0.9 视为高度匹配，0.6-0.9 视为中等匹配 */
    if (best.score >= 0.9) {
      return { action: "fuzzy_match_high", match: best.entry, score: best.score };
    }
    return { action: "fuzzy_match_medium", match: best.entry, score: best.score };
  }

  return { action: "no_match" };
}

/**
 * 从 vault 中构建索引
 *
 * 扫描 Permanent 和 Inbox/wiki-engine 目录下的所有页面，
 * 提取标题、别名、标签、类型和路径信息。
 *
 * @param vault - Vault 读取器实例
 * @returns vault 索引（VaultIndexEntry 数组）
 */
export async function buildVaultIndex(vault: VaultReader): Promise<VaultIndex> {
  const pages = await vault.scan({
    includeDirs: ["50-Knowledge/Permanent", "00-Inbox/wiki-engine"],
  });

  return pages.map((p: WikiPage) => ({
    title: p.title,
    aliases: p.aliases,
    tags: p.tags,
    type: p.type,
    path: p.filePath,
  }));
}
