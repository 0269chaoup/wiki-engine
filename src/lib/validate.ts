/**
 * @file 文档验证逻辑模块
 *
 * 验证 Obsidian vault 中知识文件的 frontmatter 完整性和结构规范性。
 *
 * 验证规则：
 * - type 字段：必须存在且为有效值（Story/Event/Entity/Concept）
 * - domain 字段：必须存在且为预定义领域之一
 * - created 字段：必须存在
 * - status 字段：Concept 类型必须包含
 * - 归档信息块：必须包含 🗂️ 或 "归档信息" 标记
 * - 旧格式检测：检查 related:: 和 source:: 内联元数据
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

/**
 * 验证问题接口
 * 表示单个文件中的一个验证问题
 */
export interface ValidationIssue {
  /** 问题所在的文件路径 */
  file: string;
  /** 严重程度：error（错误）或 warning（警告） */
  severity: "error" | "warning";
  /** 问题涉及的字段名 */
  field: string;
  /** 问题详细描述 */
  detail: string;
}

/**
 * 验证结果接口
 * 汇总所有文件的验证情况
 */
export interface ValidationResult {
  /** 扫描的文件总数 */
  totalFiles: number;
  /** 无问题的文件数 */
  clean: number;
  /** 警告数量 */
  warnings: number;
  /** 错误数量 */
  errors: number;
  /** 所有问题列表 */
  issues: ValidationIssue[];
}

/** 有效的页面类型 */
const VALID_TYPES = ["Story", "Event", "Entity", "Concept"];

/** 有效的知识领域列表 */
const VALID_DOMAINS = [
  "AI与大模型", "项目管理", "软件开发", "OpenClaw", "计算机图形学",
  "思想史", "加密货币与DeFi", "地缘经济", "语录", "综合",
];

/** 有效的状态值列表 */
const VALID_STATUS = ["🌱 Seed", "🌿 Growing", "🌲 Evergreen"];

/**
 * @description 验证单个知识文件的 frontmatter 和结构
 *
 * 检查项：
 * 1. type 字段：是否存在且为有效类型
 * 2. domain 字段：是否存在且为标准领域
 * 3. created 字段：是否存在
 * 4. status 字段：Concept 类型必须包含
 * 5. 归档信息块：是否包含 🗂️ 或 "归档信息" 标记
 * 6. 旧格式内联元数据：检查 related:: 和 source::
 *
 * @param vaultRoot - vault 根目录路径
 * @param filePath - 文件相对于 vault 根目录的路径
 * @returns 验证问题数组（空数组表示无问题）
 */
export function validateFile(
  vaultRoot: string,
  filePath: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const abs = path.resolve(vaultRoot, filePath);
  if (!fs.existsSync(abs)) {
    return [{ file: filePath, severity: "error", field: "file", detail: "File not found" }];
  }

  const raw = fs.readFileSync(abs, "utf-8");
  let data: Record<string, unknown>;
  try {
    ({ data } = matter(raw));
  } catch (e) {
    return [{ file: filePath, severity: "error", field: "frontmatter", detail: `YAML parse error: ${(e as Error).message?.slice(0, 80)}` }];
  }

  /** 检查 type 字段 */
  if (!data.type) {
    issues.push({ file: filePath, severity: "error", field: "type", detail: "Missing type field" });
  } else if (!VALID_TYPES.includes(String(data.type))) {
    issues.push({ file: filePath, severity: "warning", field: "type", detail: `Invalid type: ${data.type}` });
  }

  /** 检查 domain 字段 */
  if (!data.domain) {
    issues.push({ file: filePath, severity: "error", field: "domain", detail: "Missing domain field" });
  } else if (!VALID_DOMAINS.includes(String(data.domain))) {
    issues.push({ file: filePath, severity: "warning", field: "domain", detail: `Non-standard domain: ${data.domain}` });
  }

  /** 检查 created 字段 */
  if (!data.created) {
    issues.push({ file: filePath, severity: "warning", field: "created", detail: "Missing created date" });
  }

  /** 检查 Concept 类型的 status 字段 */
  if (String(data.type) === "Concept" && !data.status) {
    issues.push({ file: filePath, severity: "warning", field: "status", detail: "Concept missing status field" });
  }

  /** 检查归档信息块 */
  if (!raw.includes("🗂️") && !raw.includes("归档信息")) {
    issues.push({ file: filePath, severity: "warning", field: "archive", detail: "Missing 归档信息 block" });
  }

  /** 检查旧格式内联元数据 */
  const bodyLines = raw.split("\n");
  const fmEnd = raw.indexOf("---", 3);
  const body = fmEnd > 0 ? raw.slice(fmEnd + 3) : raw;
  if (body.match(/^related::/m)) {
    issues.push({ file: filePath, severity: "warning", field: "metadata", detail: "Contains old related:: inline metadata" });
  }
  if (body.match(/^source::/m)) {
    issues.push({ file: filePath, severity: "warning", field: "metadata", detail: "Contains old source:: inline metadata" });
  }

  return issues;
}

/**
 * @description 验证所有知识文件
 *
 * 遍历 Permanent 目录下指定子目录中的所有 .md 文件，
 * 对每个文件执行验证并汇总结果。
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：dirs（自定义子目录列表）、fix（是否自动修复）
 * @returns 验证结果汇总
 */
export async function validateAll(
  vaultRoot: string,
  opts?: { dirs?: string[]; fix?: boolean }
): Promise<ValidationResult> {
  const dirs = opts?.dirs ?? ["Stories", "Events", "Entities", "Concepts"];
  const allIssues: ValidationIssue[] = [];
  let totalFiles = 0;

  for (const dir of dirs) {
    const pattern = `50-Knowledge/Permanent/${dir}/**/*.md`;
    const files = await glob(pattern, {
      cwd: vaultRoot,
      ignore: [".obsidian/**", ".git/**"],
    });

    for (const f of files) {
      totalFiles++;
      const issues = validateFile(vaultRoot, f);
      allIssues.push(...issues);
    }
  }

  const errors = allIssues.filter(i => i.severity === "error").length;
  const warnings = allIssues.filter(i => i.severity === "warning").length;

  return {
    totalFiles,
    clean: totalFiles - new Set(allIssues.map(i => i.file)).size,
    warnings,
    errors,
    issues: allIssues,
  };
}
