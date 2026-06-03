/**
 * @file MOC（Map of Content）同步模块
 *
 * 负责将知识文件的 wikilink 同步到对应的 MOC 索引文件中。
 *
 * 同步逻辑：
 * 1. 读取文件的 frontmatter → 提取 type、domain、title
 * 2. 确定目标 MOC 文件：MOCs/MOC-{domain}.md
 * 3. 检查 MOC 中是否已包含 [[title]]
 * 4. 如未包含，在 MOC 末尾追加 `- [[title]] — {摘要}`
 * 5. 写回 MOC 文件
 *
 * 支持单文件同步和批量同步两种模式。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

/**
 * MOC 同步结果接口
 * 表示单个文件的 MOC 同步操作结果
 */
export interface MocSyncResult {
  /** 被同步的源文件路径 */
  file: string;
  /** 目标 MOC 文件名 */
  moc: string;
  /** 同步动作：已添加、已存在链接、无对应 MOC、出错 */
  action: "added" | "already_linked" | "no_moc" | "error";
  /** 详细信息（可选） */
  detail?: string;
}

/**
 * @description 将单个知识文件的链接同步到对应的 MOC 文件中
 *
 * 同步流程：
 * 1. 读取文件 frontmatter → 提取 type、domain、title
 * 2. 确定目标 MOC 路径：50-Knowledge/MOCs/MOC-{domain}.md
 * 3. 检查 MOC 中是否已包含 [[title]] 的 wikilink
 * 4. 如未包含，在 MOC 文件末尾追加条目
 * 5. 写回 MOC 文件
 *
 * @param vaultRoot - vault 根目录路径
 * @param filePath - 源文件相对于 vault 根目录的路径
 * @returns MOC 同步结果
 */
export async function syncFileToMoc(
  vaultRoot: string,
  filePath: string
): Promise<MocSyncResult> {
  const abs = path.resolve(vaultRoot, filePath);
  if (!fs.existsSync(abs)) {
    return { file: filePath, moc: "", action: "error", detail: "File not found" };
  }

  /** 解析 frontmatter 元数据 */
  const raw = fs.readFileSync(abs, "utf-8");
  let data: Record<string, unknown>;
  try {
    ({ data } = matter(raw));
  } catch (e) {
    return { file: filePath, moc: "", action: "error", detail: `YAML parse error: ${(e as Error).message?.slice(0, 80)}` };
  }

  /** 提取关键字段（提供默认值） */
  const title = String(data.title ?? path.basename(filePath, ".md"));
  const type = String(data.type ?? "Concept");
  const domain = String(data.domain ?? "综合");
  /** 从文件内容中提取 One-Liner 摘要 */
  const oneliner = extractOneliner(raw);

  /** 确定目标 MOC 文件路径 */
  const mocFileName = `MOC-${domain}.md`;
  const mocPath = path.join(vaultRoot, "50-Knowledge", "MOCs", mocFileName);

  if (!fs.existsSync(mocPath)) {
    return { file: filePath, moc: mocFileName, action: "no_moc", detail: `MOC not found: ${mocPath}` };
  }

  /** 读取 MOC 文件内容 */
  const mocRaw = fs.readFileSync(mocPath, "utf-8");

  /** 检查 MOC 中是否已包含该页面的 wikilink */
  const linkPattern = new RegExp(`\\[\\[${escapeRegex(title)}[\\]|]`);
  if (linkPattern.test(mocRaw)) {
    return { file: filePath, moc: mocFileName, action: "already_linked" };
  }

  /** 页面类型 → emoji 映射 */
  const typeEmoji: Record<string, string> = {
    Entity: "🏷️",
    Event: "⚡",
    Story: "📖",
    Concept: "💡",
  };
  const emoji = typeEmoji[type] ?? "💡";
  /** 构建 MOC 条目：- [[title]] — 摘要 */
  const entry = `- [[${title}]]${oneliner ? ` — ${oneliner}` : ""}`;

  /** 在 MOC 文件末尾追加条目 */
  const updated = mocRaw.trimEnd() + "\n\n" + entry + "\n";

  fs.writeFileSync(mocPath, updated, "utf-8");

  return { file: filePath, moc: mocFileName, action: "added", detail: entry };
}

/**
 * @description 批量同步 Permanent 目录下所有文件到对应的 MOC
 *
 * 遍历指定子目录（默认 Stories/Events/Entities/Concepts）中的所有 .md 文件，
 * 逐个执行 MOC 同步。
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：dryRun（模拟运行）、dirs（自定义子目录列表）
 * @returns 所有文件的同步结果数组
 */
export async function syncAllToMocs(
  vaultRoot: string,
  opts?: { dryRun?: boolean; dirs?: string[] }
): Promise<MocSyncResult[]> {
  const dirs = opts?.dirs ?? ["Stories", "Events", "Entities", "Concepts"];
  const results: MocSyncResult[] = [];

  for (const dir of dirs) {
    const pattern = `50-Knowledge/Permanent/${dir}/**/*.md`;
    const files = await glob(pattern, {
      cwd: vaultRoot,
      ignore: [".obsidian/**", ".git/**"],
    });

    for (const f of files) {
      if (opts?.dryRun) {
        /** 模拟运行模式：只检查不写入 */
        const abs = path.join(vaultRoot, f);
        const raw = fs.readFileSync(abs, "utf-8");
        let data: Record<string, unknown>;
        try {
          ({ data } = matter(raw));
        } catch {
          results.push({ file: f, moc: "", action: "error", detail: "YAML parse error" });
          continue;
        }
        const domain = String(data.domain ?? "综合");
        const mocPath = path.join(vaultRoot, "50-Knowledge", "MOCs", `MOC-${domain}.md`);
        const title = String(data.title ?? path.basename(f, ".md"));

        if (!fs.existsSync(mocPath)) {
          results.push({ file: f, moc: `MOC-${domain}.md`, action: "no_moc" });
          continue;
        }

        const mocRaw = fs.readFileSync(mocPath, "utf-8");
        const linkPattern = new RegExp(`\\[\\[${escapeRegex(title)}[\\]|]`);
        const linked = linkPattern.test(mocRaw);
        results.push({
          file: f,
          moc: `MOC-${domain}.md`,
          action: linked ? "already_linked" : "added",
        });
      } else {
        /** 正式模式：执行同步 */
        const result = await syncFileToMoc(vaultRoot, f);
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * @description 从文件内容中提取 One-Liner 摘要
 *
 * 匹配格式：**One-Liner**: 摘要内容
 *
 * @param content - 文件原始内容
 * @returns One-Liner 摘要文本，未找到则返回空字符串
 */
function extractOneliner(content: string): string {
  const m = content.match(/\*\*One-Liner\*\*:\s*(.+?)(?:\n|$)/);
  return m?.[1]?.trim() ?? "";
}

/**
 * @description 转义正则表达式特殊字符
 *
 * @param s - 原始字符串
 * @returns 转义后的安全字符串
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
