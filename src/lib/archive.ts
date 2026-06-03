/**
 * @file 归档核心逻辑模块
 *
 * 负责将 Inbox 中的学习批次归档到 Permanent 目录。
 * 支持四种冲突解决策略：合并（merge）、覆盖（overwrite）、重命名（rename）、跳过（skip）。
 * 归档后自动同步 MOC（Map of Content）并写入每日日志。
 *
 * 归档流程：
 * 1. 读取 _manifest.yaml，校验批次状态
 * 2. 扫描批次目录中的所有 .md 文件
 * 3. 对每个文件：检查冲突 → 应用策略 → 更新 frontmatter → 写入 Permanent
 * 4. 同步 MOC（通过 moc-sync 模块）
 * 5. 写入每日日志
 * 6. 清理 Inbox 批次目录
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";
import type { ArchiveResult, BatchManifest } from "./types.js";
import { readManifest, updateManifestStatus } from "./manifest.js";
import { syncFileToMoc } from "./moc-sync.js";

/**
 * 冲突解决策略类型
 * - merge: 合并新内容到已有文件末尾
 * - overwrite: 覆盖已有文件
 * - rename: 在文件名后追加日期后缀
 * - skip: 跳过冲突文件
 */
type ConflictStrategy = "merge" | "overwrite" | "rename" | "skip";

/**
 * 归档选项接口
 * 配置归档行为的参数集合
 */
export interface ArchiveOptions {
  /** 批次 ID（对应 Inbox 中的子目录名） */
  batchId: string;
  /** Obsidian vault 根目录的绝对路径 */
  vaultRoot: string;
  /** 冲突解决策略，默认为 "merge" */
  strategy?: ConflictStrategy;
  /** 是否为模拟运行（不实际写入文件） */
  dryRun?: boolean;
  /** 是否跳过去重检测 */
  noDedup?: boolean;
  /** 是否输出详细日志 */
  verbose?: boolean;
}

/**
 * @description 将一个批次从 Inbox 归档到 Permanent 目录
 *
 * 完整归档流程：
 * 1. 读取 _manifest.yaml，校验批次状态（必须为 pending）
 * 2. 扫描批次目录中的所有 .md 文件
 * 3. 对每个文件：检查冲突 → 应用冲突策略 → 更新 frontmatter → 写入 Permanent
 * 4. 通过 moc-sync 模块同步 MOC 文件
 * 5. 将归档记录写入当天的每日日志
 * 6. 更新清单状态为 archived，若无跳过文件则删除批次目录
 *
 * @param opts - 归档配置选项
 * @returns 归档结果，包含已归档、跳过、警告等信息
 * @throws 当批次目录不存在、无清单、或批次已归档时抛出错误
 */
export async function archiveBatch(opts: ArchiveOptions): Promise<ArchiveResult> {
  const { batchId, vaultRoot, dryRun, noDedup, verbose } = opts;
  const strategy: ConflictStrategy = opts.strategy ?? "merge";

  /** 初始化归档结果对象 */
  const result: ArchiveResult = {
    batch_id: batchId,
    archived: [],
    skipped: [],
    warnings: [],
    moc_updates: [],
  };

  /** ── 步骤 1: 查找并校验批次 ── */
  const batchDir = path.join(vaultRoot, "00-Inbox", "wiki-engine", batchId);
  if (!fs.existsSync(batchDir)) {
    throw new Error(`Batch not found: ${batchDir}`);
  }

  /** 读取批次清单 */
  const manifest = readManifest(batchDir);
  if (!manifest) {
    throw new Error(`No _manifest.yaml found in ${batchDir}`);
  }
  /** 校验批次状态：已归档的批次不允许重复归档 */
  if (manifest.status === "archived") {
    throw new Error(`Batch ${batchId} is already archived`);
  }

  /** ── 步骤 2: 扫描批次目录中的所有 .md 文件 ── */
  const files = await glob("**/*.md", {
    cwd: batchDir,
    ignore: ["_manifest.yaml"],
    absolute: false,
  });

  if (files.length === 0) {
    throw new Error(`No .md files found in ${batchDir}`);
  }

  if (verbose) {
    console.log(`   Found ${files.length} files to archive`);
  }

  /** ── 步骤 3: 逐个处理文件 ── */
  for (const relFile of files) {
    const srcPath = path.join(batchDir, relFile);
    const content = fs.readFileSync(srcPath, "utf-8");
    /** 使用 gray-matter 分离 frontmatter 和正文 */
    const { data: fm, content: body } = matter(content);

    /**
     * 根据文件的子目录名确定目标目录映射
     * Inbox 中按类型分目录：concepts, entities, events, stories
     * Permanent 中对应：Concepts, Entities, Events, Stories
     */
    const typeDirMap: Record<string, string> = {
      concepts: "Concepts",
      entities: "Entities",
      events: "Events",
      stories: "Stories",
    };

    /** 解析文件路径，确定所属子目录 */
    const parts = relFile.split(path.sep);
    const subDir = parts.length > 1 ? parts[0] : inferTypeDir(fm.type);
    /** 目标目录名，默认回退到 Concepts */
    const permanentDir = typeDirMap[subDir] ?? "Concepts";
    const targetDir = path.join(vaultRoot, "50-Knowledge", "Permanent", permanentDir);
    const filename = path.basename(relFile);
    const targetPath = path.join(targetDir, filename);

    /** 检查目标路径是否已存在（冲突检测） */
    const conflict = fs.existsSync(targetPath);

    /** 模拟运行模式：只记录不写入 */
    if (dryRun) {
      if (conflict) {
        result.warnings.push(`⚠️  CONFLICT: ${permanentDir}/${filename} exists (strategy: ${strategy})`);
      } else {
        result.archived.push({ file: relFile, target: `${permanentDir}/${filename}`, action: "create" });
      }
      continue;
    }

    /** 根据冲突策略处理 */
    if (conflict) {
      switch (strategy) {
        /** 跳过策略：记录跳过原因 */
        case "skip":
          result.skipped.push({ file: relFile, reason: `conflict: ${filename} exists` });
          continue;

        /** 覆盖策略：直接进入后续写入流程 */
        case "overwrite":
          break;

        /** 重命名策略：在文件名后追加日期后缀 */
        case "rename": {
          const date = new Date().toISOString().split("T")[0];
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          const newFilename = `${base}-${date}${ext}`;
          const newPath = path.join(targetDir, newFilename);
          const mergedContent = buildArchivedContent(body, fm, batchId, noDedup);
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(newPath, mergedContent, "utf-8");
          result.archived.push({ file: relFile, target: `${permanentDir}/${newFilename}`, action: "rename" });
          /** 同步更新对应的 MOC 文件 */
          const mocResult = await syncFileToMoc(vaultRoot, path.relative(vaultRoot, newPath));
          result.moc_updates.push({ moc: mocResult.moc, action: mocResult.action, detail: mocResult.detail });
          continue;
        }

        /** 合并策略：将新内容追加到已有文件末尾 */
        case "merge": {
          const existingRaw = fs.readFileSync(targetPath, "utf-8");
          const { content: existingBody } = matter(existingRaw);

          let mergedBody: string;
          if (noDedup) {
            /** 简单追加模式：直接拼接，带分隔线 */
            mergedBody = existingBody.trimEnd() + "\n\n---\n\n" +
              `## 🔄 补充收录 (${new Date().toISOString().split("T")[0]})\n` +
              `> 来源: ${batchId}\n\n` +
              body.trim();
          } else {
            /** LLM 去重模式：比较新旧内容后决定追加或合并摘要 */
            mergedBody = await mergeWithDedup(existingBody, body, batchId);
          }

          /** 更新已有文件的 frontmatter 元数据 */
          const existingFm = matter(existingRaw).data;
          const updatedFm = {
            ...existingFm,
            status: "🗃️ 已归档",
            archived: new Date().toISOString().split("T")[0],
          };
          const mergedContent = buildFrontmatter(updatedFm) + "\n\n" + mergedBody;
          fs.writeFileSync(targetPath, mergedContent, "utf-8");
          result.archived.push({ file: relFile, target: `${permanentDir}/${filename}`, action: "merge" });
          continue;
        }
      }
    }

    /** ── 无冲突或覆盖策略：直接写入 ── */
    const archivedContent = buildArchivedContent(body, fm, batchId, noDedup);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, archivedContent, "utf-8");
    result.archived.push({
      file: relFile,
      target: `${permanentDir}/${filename}`,
      action: conflict ? "overwrite" : "create",
    });

    /** 同步更新对应的 MOC 文件 */
    const mocResult = await syncFileToMoc(vaultRoot, path.relative(vaultRoot, targetPath));
    result.moc_updates.push({ moc: mocResult.moc, action: mocResult.action, detail: mocResult.detail });
  }

  /** ── 步骤 5: 写入每日日志 ── */
  if (!dryRun && result.archived.length > 0) {
    const logEntry = buildDailyLogEntry(batchId, result);
    appendDailyLog(vaultRoot, logEntry);
    result.daily_log = logEntry;
  }

  /** ── 步骤 6: 更新清单状态并清理 Inbox 目录 ── */
  if (!dryRun) {
    updateManifestStatus(batchDir, "archived");
    /** 只有在所有文件都成功归档（无跳过）时才删除批次目录 */
    if (result.skipped.length === 0) {
      fs.rmSync(batchDir, { recursive: true, force: true });
    }
  }

  return result;
}

/**
 * @description 构建归档文件的最终内容
 *
 * 更新 frontmatter 中的状态为 "🗃️ 已归档"，并添加归档日期和来源批次信息。
 *
 * @param body - Markdown 正文内容
 * @param originalFm - 原始 frontmatter 数据
 * @param batchId - 来源批次 ID
 * @param _noDedup - 是否跳过去重（预留参数）
 * @returns 完整的 Markdown 文件内容（含 frontmatter）
 */
function buildArchivedContent(
  body: string,
  originalFm: Record<string, any>,
  batchId: string,
  _noDedup?: boolean,
): string {
  const today = new Date().toISOString().split("T")[0];
  const fm = {
    ...originalFm,
    status: "🗃️ 已归档",
    archived: today,
    source: originalFm.source ?? batchId,
  };

  return buildFrontmatter(fm) + "\n\n" + body.trim();
}

/**
 * @description 使用 LLM 去重合并新旧内容
 *
 * 当前实现为简单追加模式（带分隔线和日期标记）。
 * 未来计划集成 Helios Agent 的 LLM 能力进行智能去重合并。
 *
 * @param existingBody - 已有文件的正文内容
 * @param newBody - 新增的正文内容
 * @param batchId - 来源批次 ID
 * @returns 合并后的正文内容
 */
async function mergeWithDedup(existingBody: string, newBody: string, batchId: string): Promise<string> {
  // TODO: 集成 Agent 管线的 LLM 去重能力
  // 当前使用简单追加模式，后续可通过 --finalize 流程调用 Helios Agent
  const today = new Date().toISOString().split("T")[0];
  return existingBody.trimEnd() + "\n\n---\n\n" +
    `## 🔄 补充收录 (${today})\n` +
    `> 来源: ${batchId}\n\n` +
    newBody.trim();
}

/**
 * @description 根据页面类型推断目标子目录名
 *
 * @param type - 页面类型字符串（如 "Concept", "Entity", "Event", "Story"）
 * @returns 对应的子目录名（小写形式）
 */
function inferTypeDir(type?: string): string {
  const map: Record<string, string> = {
    Concept: "concepts",
    Entity: "entities",
    Event: "events",
    Story: "stories",
  };
  return map[type ?? "Concept"] ?? "concepts";
}

/**
 * @description 将数据对象序列化为 YAML frontmatter 格式字符串
 *
 * 处理不同类型值的序列化规则：
 * - 数组：逐项以 "- " 列表格式输出
 * - 字符串：含特殊字符时用单引号包裹，否则用双引号
 * - 其他类型：直接输出
 *
 * @param data - frontmatter 数据对象
 * @returns 格式化的 YAML frontmatter 字符串（含首尾 "---" 分隔符）
 */
function buildFrontmatter(data: Record<string, any>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`);
        }
      }
    } else if (typeof v === "string") {
      /** 日期或含特殊字符的字符串使用单引号包裹 */
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /[:#{}[\\],&*?|>!%@`]/.test(v)) {
        lines.push(`${k}: '${v}'`);
      } else {
        lines.push(`${k}: "${v}"`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * @description 构建每日日志条目
 *
 * 生成格式：- `[Agent:Helios]` 归档 [[batchId]] → Permanent (类型×数量) #agent-change
 *
 * @param batchId - 批次 ID
 * @param result - 归档结果
 * @returns 日志条目字符串
 */
function buildDailyLogEntry(batchId: string, result: ArchiveResult): string {
  const count = result.archived.length;
  /** 按目标目录统计各类型数量 */
  const types = result.archived.reduce((acc, a) => {
    const dir = a.target.split("/")[0];
    acc[dir] = (acc[dir] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  /** 生成类型摘要，如 "Concepts×3, Entities×2" */
  const typeSummary = Object.entries(types)
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");

  return `- \\`[Agent:Helios]\\` 归档 [[${batchId}]] → Permanent (${typeSummary}) #agent-change`;
}

/**
 * @description 将日志条目追加到当天的每日日志文件
 *
 * 查找顺序：
 * 1. 20-Daily/{year}/{month}/{date}.md
 * 2. 20-Daily/{date}.md
 * 3. 20-Daily/{year}/{month}/第*周/{date}*.md（按周组织的目录）
 *
 * 如果日志文件不存在，会创建一个包含 "## 日志" 章节的最小模板。
 * 如果已存在但缺少 "## 日志" 章节，会在文件末尾添加。
 *
 * @param vaultRoot - vault 根目录路径
 * @param entry - 要追加的日志条目内容
 */
function appendDailyLog(vaultRoot: string, entry: string): void {
  /** 计算当天日期 */
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  /** 候选日志文件路径列表 */
  const candidates = [
    path.join(vaultRoot, "20-Daily", String(year), month, `${dateStr}.md`),
    path.join(vaultRoot, "20-Daily", `${dateStr}.md`),
  ];

  /** 也搜索按周组织的目录 */
  const weekPattern = path.join(vaultRoot, "20-Daily", String(year), month, `第*周`, `${dateStr}*.md`);
  const weekMatches = glob.sync(weekPattern);
  candidates.push(...weekMatches);

  /** 查找第一个存在的日志文件 */
  let dailyPath = candidates.find(p => fs.existsSync(p));

  if (!dailyPath) {
    /** 日志文件不存在，创建最小模板 */
    dailyPath = candidates[0];
    const dir = path.dirname(dailyPath);
    fs.mkdirSync(dir, { recursive: true });
    const template = [
      "---",
      `date: '${dateStr}'`,
      "---",
      "",
      `# ${dateStr}`,
      "",
      "## 日志",
      "",
      entry,
      "",
    ].join("\n");
    fs.writeFileSync(dailyPath, template, "utf-8");
    return;
  }

  /** 向已存在的日志文件追加条目 */
  const content = fs.readFileSync(dailyPath, "utf-8");

  if (content.includes("## 日志")) {
    /** 在 "## 日志" 标题后插入条目 */
    const updated = content.replace(
      /(## 日志\n)/,
      `$1${entry}\n`,
    );
    fs.writeFileSync(dailyPath, updated, "utf-8");
  } else {
    /** 不存在 "## 日志" 章节，在文件末尾添加 */
    const updated = content.trimEnd() + "\n\n## 日志\n\n" + entry + "\n";
    fs.writeFileSync(dailyPath, updated, "utf-8");
  }
}
