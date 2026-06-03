/**
 * @file Frontmatter 修复模块
 *
 * 自动修复 Obsidian vault 中知识文件的 frontmatter 问题。
 *
 * 修复规则：
 * - 补充缺失的 type 字段（默认 "Concept"）
 * - 规范化非标准类型（Guide → Concept、Reference → Concept 等）
 * - 补充缺失的 domain 字段（默认 "综合"）
 * - 补充缺失的 created 字段（使用文件创建时间）
 * - 为 Concept 类型补充缺失的 status 字段（默认 "🌿 Growing"）
 * - 修复损坏的 YAML 语法（如 source:: 双冒号）
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

/**
 * 修复结果接口
 * 表示单个文件的修复操作结果
 */
export interface FixResult {
  /** 被修复的文件路径 */
  file: string;
  /** 执行的修复操作列表 */
  fixes: string[];
}

/**
 * 类型规范化映射表
 * 将非标准类型映射为标准的 Concept 类型
 */
const TYPE_MAP: Record<string, string> = {
  Guide: "Concept",
  Reference: "Concept",
  Insight: "Concept",
  Resource: "Concept",
  wiki: "Concept",
  MOC: "Concept",
};

/**
 * @description 修复单个知识文件的 frontmatter
 *
 * 修复流程：
 * 1. 解析 frontmatter（如果 YAML 损坏则尝试修复）
 * 2. 检查并补充 type 字段
 * 3. 规范化非标准类型
 * 4. 补充缺失的 domain 字段
 * 5. 补充缺失的 created 字段
 * 6. 为 Concept 类型补充 status 字段
 * 7. 重建 frontmatter 并写回文件
 *
 * @param vaultRoot - vault 根目录路径
 * @param filePath - 文件相对于 vault 根目录的路径
 * @returns 修复结果（含执行的修复操作列表）
 */
export function fixFrontmatter(
  vaultRoot: string,
  filePath: string
): FixResult {
  const fixes: string[] = [];
  const abs = path.resolve(vaultRoot, filePath);
  if (!fs.existsSync(abs)) return { file: filePath, fixes: [] };

  let raw = fs.readFileSync(abs, "utf-8");
  let data: Record<string, unknown>;

  try {
    ({ data } = matter(raw));
  } catch {
    /** YAML 解析失败，尝试修复常见问题 */
    /** 修复 source:: 双冒号语法 */
    raw = raw.replace(/^source::\s*/gm, "source: ");
    /** 移除 related:: 内联元数据 */
    raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    try {
      ({ data } = matter(raw));
      fixes.push("fixed broken YAML");
    } catch {
      return { file: filePath, fixes: ["failed to fix YAML"] };
    }
  }

  /** 定位 frontmatter 边界 */
  const fmStart = raw.indexOf("---");
  const fmEnd = raw.indexOf("---", 3);
  if (fmStart < 0 || fmEnd < 0) return { file: filePath, fixes: [] };

  const body = raw.slice(fmEnd + 3);
  const changes: Record<string, unknown> = { ...data };

  /** 修复 type 字段 */
  if (!changes.type) {
    changes.type = "Concept";
    fixes.push("added type: Concept");
  }
  /** 规范化非标准类型 */
  if (TYPE_MAP[String(changes.type)]) {
    const old = changes.type;
    changes.type = TYPE_MAP[String(changes.type)];
    fixes.push(`type: ${old} → ${changes.type}`);
  }

  /** 修复 domain 字段 */
  if (!changes.domain) {
    changes.domain = "综合";
    fixes.push("added domain: 综合");
  }

  /** 修复 created 字段 */
  if (!changes.created) {
    /** 使用文件的创建时间作为默认值 */
    const stat = fs.statSync(abs);
    changes.created = stat.birthtime.toISOString().slice(0, 10);
    fixes.push(`added created: ${changes.created}`);
  }

  /** 为 Concept 类型补充 status 字段 */
  if (String(changes.type) === "Concept" && !changes.status) {
    changes.status = "🌿 Growing";
    fixes.push("added status: 🌿 Growing");
  }

  /** 重建 frontmatter */
  const fmLines = ["---"];
  for (const [key, val] of Object.entries(changes)) {
    if (val === undefined || val === null || val === "") continue;
    if (Array.isArray(val)) {
      fmLines.push(`${key}: [${val.join(", ")}]`);
    } else if (typeof val === "string" && (val.includes(":") || val.includes("#") || val.includes('"'))) {
      fmLines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      fmLines.push(`${key}: ${val}`);
    }
  }
  fmLines.push("---");

  const newRaw = fmLines.join("\n") + body;

  /** 只有在有修复操作时才写回文件 */
  if (fixes.length > 0) {
    fs.writeFileSync(abs, newRaw, "utf-8");
  }

  return { file: filePath, fixes };
}

/**
 * @description 批量修复所有知识文件的 frontmatter
 *
 * 遍历 Permanent 目录下指定子目录中的所有 .md 文件，
 * 对每个文件执行 frontmatter 修复。
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：dirs（自定义子目录列表）、dryRun（模拟运行）
 * @returns 执行了修复操作的文件结果列表
 */
export async function fixAllFrontmatter(
  vaultRoot: string,
  opts?: { dirs?: string[]; dryRun?: boolean }
): Promise<FixResult[]> {
  const dirs = opts?.dirs ?? ["Stories", "Events", "Entities", "Concepts"];
  const results: FixResult[] = [];

  for (const dir of dirs) {
    const pattern = `50-Knowledge/Permanent/${dir}/**/*.md`;
    const files = await glob(pattern, {
      cwd: vaultRoot,
      ignore: [".obsidian/**", ".git/**"],
    });

    for (const f of files) {
      const result = fixFrontmatter(vaultRoot, f);
      /** 只返回有实际修复操作的结果 */
      if (result.fixes.length > 0) {
        results.push(result);
      }
    }
  }

  return results;
}
