import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

export interface ValidationIssue {
  file: string;
  severity: "error" | "warning";
  field: string;
  detail: string;
}

export interface ValidationResult {
  totalFiles: number;
  clean: number;
  warnings: number;
  errors: number;
  issues: ValidationIssue[];
}

const VALID_TYPES = ["Story", "Event", "Entity", "Concept"];
const VALID_DOMAINS = [
  "AI与大模型", "项目管理", "软件开发", "OpenClaw", "计算机图形学",
  "思想史", "加密货币与DeFi", "地缘经济", "语录", "综合",
];
const VALID_STATUS = ["🌱 Seed", "🌿 Growing", "🌲 Evergreen"];

/**
 * Validate a single file's frontmatter and structure.
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

  // Check type
  if (!data.type) {
    issues.push({ file: filePath, severity: "error", field: "type", detail: "Missing type field" });
  } else if (!VALID_TYPES.includes(String(data.type))) {
    issues.push({ file: filePath, severity: "warning", field: "type", detail: `Invalid type: ${data.type}` });
  }

  // Check domain
  if (!data.domain) {
    issues.push({ file: filePath, severity: "error", field: "domain", detail: "Missing domain field" });
  } else if (!VALID_DOMAINS.includes(String(data.domain))) {
    issues.push({ file: filePath, severity: "warning", field: "domain", detail: `Non-standard domain: ${data.domain}` });
  }

  // Check created
  if (!data.created) {
    issues.push({ file: filePath, severity: "warning", field: "created", detail: "Missing created date" });
  }

  // Check status for Concept type
  if (String(data.type) === "Concept" && !data.status) {
    issues.push({ file: filePath, severity: "warning", field: "status", detail: "Concept missing status field" });
  }

  // Check 归档信息 block
  if (!raw.includes("🗂️") && !raw.includes("归档信息")) {
    issues.push({ file: filePath, severity: "warning", field: "archive", detail: "Missing 归档信息 block" });
  }

  // Check for old inline metadata
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
 * Validate all knowledge files.
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
