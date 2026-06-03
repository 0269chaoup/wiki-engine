/**
 * @file Stage 4: Inbox 分发模块
 *
 * 将生成的页面写入 Inbox 目录（00-Inbox/wiki-engine/{batch_id}/），
 * 按类型分目录存放，并创建 _manifest.yaml 清单文件。
 *
 * 目录结构：
 * 00-Inbox/wiki-engine/{batch_id}/
 * ├── concepts/       ← 概念页面
 * ├── entities/       ← 实体页面
 * ├── events/         ← 事件页面
 * ├── stories/        ← 故事页面
 * └── _manifest.yaml  ← 批次清单
 */

import fs from "fs";
import path from "path";
import type { SourceDocument, InboxBatch, BatchManifest, AlignmentAction, ExtractedEntity, ExtractedEvent, ExtractedStory } from "./types.js";
import { writeManifest, generateBatchId } from "./manifest.js";

/**
 * 将生成的页面分发到 Inbox 目录
 *
 * 流程：
 * 1. 生成批次 ID（如果未提供）
 * 2. 创建目录结构（concepts/entities/events/stories）
 * 3. 写入 Story 页面
 * 4. 写入实体/事件/概念页面（补充管线元数据）
 * 5. 创建批次清单
 *
 * @param vaultRoot - vault 根目录路径
 * @param source - 源文档信息
 * @param pages - 生成的页面列表（含 frontmatter 和 content）
 * @param stories - Story 列表
 * @param entities - 实体列表
 * @param events - 事件列表
 * @param alignmentActions - 对齐操作列表
 * @param batchId - 批次 ID（可选，不提供则自动生成）
 * @returns Inbox 批次对象（包含批次 ID、目录路径、页面列表和清单）
 */
export function dispatchToInbox(
  vaultRoot: string,
  source: SourceDocument,
  pages: { frontmatter: Record<string, any>; content: string }[],
  stories: ExtractedStory[],
  entities: ExtractedEntity[],
  events: ExtractedEvent[],
  alignmentActions: AlignmentAction[],
  batchId?: string,
): InboxBatch {
  /** 生成或使用提供的批次 ID */
  const bid = batchId ?? generateBatchId(source.title);
  const inboxDir = path.join(vaultRoot, "00-Inbox", "wiki-engine", bid);

  /** 创建子目录结构 */
  const dirs = ["concepts", "entities", "events", "stories"];
  for (const d of dirs) {
    fs.mkdirSync(path.join(inboxDir, d), { recursive: true });
  }

  const dispatched: InboxBatch["pages"] = [];

  /** 写入 Story 页面 */
  for (const story of stories) {
    const storyTitle = story.title || "untitled-story";
    const filename = `${sanitizeFilename(storyTitle)}.md`;
    /** 构建 frontmatter（包含管线元数据） */
    const frontmatter = buildFrontmatter({
      title: storyTitle,
      type: "Story",
      tags: story.tags,
      status: "📥 待学习",
      created: new Date().toISOString().split("T")[0],
      source: source.url ?? source.title,
    });
    const filePath = path.join("stories", filename);
    fs.writeFileSync(path.join(inboxDir, filePath), `${frontmatter}\n\n${story.content || ""}`, "utf-8");
    dispatched.push({
      page: { frontmatter: { title: storyTitle, type: "story" }, content: story.content || "" },
      path: filePath,
    });
  }

  /** 页面类型 → 子目录名映射 */
  const typeDirMap: Record<string, string> = {
    entity: "entities",
    concept: "concepts",
    event: "events",
    story: "stories",
  };

  /** 写入实体/事件/概念页面 */
  for (const page of pages) {
    const fm = page.frontmatter ?? {};
    /** 根据类型确定子目录，默认为 concepts */
    const typeDir = typeDirMap[fm.type] || "concepts";
    const filename = `${sanitizeFilename(fm.title ?? "untitled")}.md`;

    /** 补充管线元数据到 frontmatter */
    const enrichedFm = {
      ...fm,
      status: "📥 待学习",
      created: fm.created ?? new Date().toISOString().split("T")[0],
      source: fm.source ?? (source.url ?? source.title),
    };

    const frontmatter = buildFrontmatter(enrichedFm);
    const filePath = path.join(typeDir, filename);
    fs.writeFileSync(path.join(inboxDir, filePath), `${frontmatter}\n\n${page.content ?? ""}`, "utf-8");
    dispatched.push({ page, path: filePath });
  }

  /** 构建批次清单 */
  const manifest: BatchManifest = {
    batch_id: bid,
    source,
    created_at: new Date().toISOString().split("T")[0],
    items_count: {
      entities: entities.filter(e => e.type === "entity").length,
      events: events.length,
      stories: stories.length,
      concepts: entities.filter(e => e.type === "concept").length,
    },
    alignment_actions: alignmentActions,
    status: "pending",
  };

  /** 写入清单文件 */
  writeManifest(inboxDir, manifest);

  return {
    batch_id: bid,
    base_dir: path.relative(vaultRoot, inboxDir),
    pages: dispatched,
    manifest,
  };
}

/**
 * 清理文件名中的非法字符
 *
 * 替换文件系统不允许的字符（/\:*?"<>|）为连字符，
 * 合并空白，截断至 100 字符。
 *
 * @param name - 原始文件名
 * @returns 清理后的安全文件名
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "-")    /** 替换非法字符 */
    .replace(/\s+/g, " ")              /** 合并连续空白 */
    .trim()
    .slice(0, 100);                     /** 截断至 100 字符 */
}

/**
 * 构建 YAML frontmatter 字符串
 *
 * 手动构建 YAML 格式的 frontmatter（--- 包裹），
 * 支持字符串、数组、数字等类型。
 * 对包含特殊字符的字符串使用单引号包裹。
 *
 * @param data - frontmatter 数据对象
 * @returns 格式化的 YAML frontmatter 字符串
 */
function buildFrontmatter(data: Record<string, any>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    /** 跳过 undefined 和 null 值 */
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      /** 数组类型：空数组直接写 []，否则逐项列出 */
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          /** 对数组项中的双引号进行转义 */
          lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`);
        }
      }
    } else if (typeof v === "string") {
      /** 字符串类型：日期格式或含特殊字符的用单引号包裹 */
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /[:#{}[\\],&*?|>!%@`]/.test(v)) {
        lines.push(`${k}: '${v}'`);
      } else {
        lines.push(`${k}: "${v}"`);
      }
    } else {
      /** 其他类型（数字、布尔等）：直接输出 */
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
