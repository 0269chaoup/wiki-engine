import type { ExtractedEntity, ExtractedEvent, AlignedExtraction, AlignmentAction, AlignmentConflict, VaultIndex, VaultIndexEntry } from "./types.js";
import type { WikiPage } from "./types.js";
import type { VaultReader } from "./vault.js";
import { fuzzyScore } from "./dedup.js";

/**
 * Stage 2: Vault Alignment
 *
 * Takes extracted entities/events and aligns them with existing vault content.
 * Decides: create / merge / rename for each item.
 */
export async function alignToVault(
  entities: ExtractedEntity[],
  events: ExtractedEvent[],
  vault: VaultReader,
): Promise<AlignedExtraction> {
  // Build vault index
  const index = await buildVaultIndex(vault);

  const actions: AlignmentAction[] = [];
  const conflicts: AlignmentConflict[] = [];
  const alignedItems: ExtractedEntity[] = [];

  for (const entity of entities) {
    const result = alignItem(entity.name, entity.tags, index);

    switch (result.action) {
      case "exact_match":
        // Merge: same name already exists
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
        // Merge: very similar name (score >= 0.9)
        actions.push({
          item_name: entity.name,
          action: "merge",
          target_existing: result.match!.path,
          resolved_name: result.match!.title,
          reason: `高度相似 (${(result.score! * 100).toFixed(0)}%): ${result.match!.title}`,
        });
        // Override name to match existing
        alignedItems.push({ ...entity, name: result.match!.title });
        break;

      case "fuzzy_match_medium":
        // Conflict: needs user/LLM arbitration
        conflicts.push({
          new_name: entity.name,
          candidates: [{ title: result.match!.title, path: result.match!.path, score: result.score! }],
          reason: `模糊匹配 (${(result.score! * 100).toFixed(0)}%): 需要判断是否同一事物`,
        });
        alignedItems.push(entity);
        break;

      case "no_match":
        // Create: new item
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

interface AlignResult {
  action: "exact_match" | "fuzzy_match_high" | "fuzzy_match_medium" | "no_match";
  match?: VaultIndexEntry;
  score?: number;
}

function alignItem(name: string, tags: string[], index: VaultIndex): AlignResult {
  const nameLower = name.toLowerCase();

  // Stage 1: Exact title/alias match
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

  // Stage 2: Fuzzy match
  let best: { entry: VaultIndexEntry; score: number } | null = null;

  for (const entry of index) {
    const { score } = fuzzyScore(name, entry.title, tags, entry.tags);
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { entry, score };
    }
  }

  if (best) {
    if (best.score >= 0.9) {
      return { action: "fuzzy_match_high", match: best.entry, score: best.score };
    }
    return { action: "fuzzy_match_medium", match: best.entry, score: best.score };
  }

  return { action: "no_match" };
}

/**
 * Build a VaultIndex from all pages in the vault.
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
