/**
 * @file check-links.ts
 * @description MOC/文档双链检查与修复
 * 扫描指定目录中的 markdown 文件，检测 broken wikilinks（指向不存在文档的链接），
 * 支持自动修复（移除路径前缀、修正文件名不匹配）。
 */
import * as fs from "fs";
import * as path from "path";

/** 链接检查结果 */
export interface BrokenLink {
  /** 源文件路径 */
  sourceFile: string;
  /** 原始链接文本 */
  link: string;
  /** 行号 */
  line: number;
  /** 问题类型 */
  issue: "missing" | "prefix" | "name_mismatch";
  /** 建议修复 */
  suggestion?: string;
}

/** 检查结果汇总 */
export interface CheckLinksResult {
  totalFiles: number;
  totalLinks: number;
  brokenLinks: BrokenLink[];
  fixedCount: number;
}

/** 检查选项 */
export interface CheckLinksOptions {
  /** 限制扫描的子目录（相对于 vaultRoot） */
  dirs?: string[];
  /** 是否自动修复 */
  fix?: boolean;
}

/**
 * 获取 vault 中所有 markdown 文件的 basename 集合
 */
function getAllFileBasenames(vaultRoot: string): Map<string, string> {
  const basenames = new Map<string, string>();

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath);
        }
      } else if (entry.name.endsWith(".md")) {
        const basename = entry.name.replace(/\.md$/, "");
        basenames.set(basename, fullPath);
      }
    }
  }

  walk(vaultRoot);
  return basenames;
}

/**
 * 模糊匹配文件名
 * 忽略：问号、冒号、空格、下划线、引号、破折号
 */
function fuzzyMatch(link: string, basenames: Map<string, string>): string | null {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[？：："""\s_]/g, "")
      .replace(/——/g, "-");

  const linkNorm = normalize(link);

  for (const [basename] of basenames) {
    const basenameNorm = normalize(basename);
    if (linkNorm === basenameNorm) return basename;
    if (linkNorm.includes(basenameNorm) || basenameNorm.includes(linkNorm)) return basename;
  }

  return null;
}

/**
 * 检查单个文件中的所有链接
 */
function checkFileLinks(
  filePath: string,
  basenames: Map<string, string>
): BrokenLink[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const broken: BrokenLink[] = [];

  const linkRegex = /\[\[([^\]]+)\]\]/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(line)) !== null) {
      const link = match[1];

      // 跳过外部链接、锚点链接、嵌入引用
      if (link.startsWith("http") || link.startsWith("#") || link.includes("![")) continue;

      // 提取文件名（去掉路径前缀）
      const basename = link.includes("/") ? link.split("/").pop()! : link;

      // 1. 精确匹配
      if (basenames.has(basename)) continue;

      // 2. 检查是否有路径前缀问题
      if (link.includes("/")) {
        if (basenames.has(basename)) {
          broken.push({
            sourceFile: filePath,
            link,
            line: i + 1,
            issue: "prefix",
            suggestion: `[[${basename}]]`,
          });
          continue;
        }
      }

      // 3. 模糊匹配
      const fuzzyResult = fuzzyMatch(basename, basenames);
      if (fuzzyResult) {
        broken.push({
          sourceFile: filePath,
          link,
          line: i + 1,
          issue: "name_mismatch",
          suggestion: `[[${fuzzyResult}]]`,
        });
        continue;
      }

      // 4. 真正找不到
      broken.push({
        sourceFile: filePath,
        link,
        line: i + 1,
        issue: "missing",
      });
    }
  }

  return broken;
}

/**
 * 检查 vault 中指定目录的文档双链
 * @param vaultRoot vault 根目录
 * @param options 检查选项
 */
export async function checkLinks(
  vaultRoot: string,
  options: CheckLinksOptions = {}
): Promise<CheckLinksResult> {
  const { dirs, fix = false } = options;
  const basenames = getAllFileBasenames(vaultRoot);

  // 收集要扫描的文件
  const filesToScan: string[] = [];

  if (dirs && dirs.length > 0) {
    // 扫描指定目录
    for (const dir of dirs) {
      const fullPath = path.join(vaultRoot, dir);
      if (!fs.existsSync(fullPath)) continue;

      function walkDir(d: string) {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith(".")) walkDir(entryPath);
          } else if (entry.name.endsWith(".md")) {
            filesToScan.push(entryPath);
          }
        }
      }

      walkDir(fullPath);
    }
  } else {
    // 扫描所有 MOC 文件
    const mocDir = path.join(vaultRoot, "50-Knowledge", "MOCs");
    if (fs.existsSync(mocDir)) {
      const entries = fs.readdirSync(mocDir);
      for (const entry of entries) {
        if (entry.endsWith(".md") && entry.startsWith("MOC-")) {
          filesToScan.push(path.join(mocDir, entry));
        }
      }
    }
  }

  // 检查所有文件
  const allBroken: BrokenLink[] = [];
  for (const file of filesToScan) {
    const broken = checkFileLinks(file, basenames);
    allBroken.push(...broken);
  }

  // 统计总链接数
  let totalLinks = 0;
  for (const file of filesToScan) {
    const content = fs.readFileSync(file, "utf-8");
    const matches = content.match(/\[\[[^\]]+\]\]/g);
    if (matches) totalLinks += matches.length;
  }

  // 自动修复
  let fixedCount = 0;
  if (fix && allBroken.length > 0) {
    const byFile = new Map<string, BrokenLink[]>();
    for (const link of allBroken) {
      const existing = byFile.get(link.sourceFile) ?? [];
      existing.push(link);
      byFile.set(link.sourceFile, existing);
    }

    for (const [file, links] of byFile) {
      let content = fs.readFileSync(file, "utf-8");
      for (const link of links) {
        if (link.suggestion) {
          const oldLink = `[[${link.link}]]`;
          if (content.includes(oldLink)) {
            content = content.replace(oldLink, link.suggestion);
            fixedCount++;
          }
        }
      }
      fs.writeFileSync(file, content, "utf-8");
    }
  }

  return {
    totalFiles: filesToScan.length,
    totalLinks,
    brokenLinks: allBroken,
    fixedCount,
  };
}
