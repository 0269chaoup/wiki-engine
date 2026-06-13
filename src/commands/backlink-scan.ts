/**
 * @file backlink-scan.ts
 * @description 双链补全扫描命令
 *
 * 扫描 50-Knowledge/ 下所有文件，找出「正文中提到了某个概念但没有用 [[wikilink]] 链接」的情况，
 * 自动补上双链。只处理 Permanent 目录，不动 Inbox。
 *
 * 保护规则：
 * - 只处理 50-Knowledge/，不动 00-Inbox/
 * - 已有 [[...]] 的不重复处理
 * - 代码块内、frontmatter 内的文本跳过
 * - 每个文件每个概念只补首次出现
 * - 概念名长度 >= 2 才处理（避免误匹配短词）
 * - 不替换纯数字、纯标点
 * - dry-run 模式预览变更
 */

import { Command } from "commander";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { buildContext, row } from "../lib/cli-utils.js";

/** 停用词：这些词太通用，不应被自动链接 */
const STOPWORDS = new Set([
  // 英文通用词
  "note", "notes", "skill", "error", "event", "story", "type", "name",
  "key", "value", "data", "code", "test", "run", "set", "get", "add",
  "new", "old", "top", "end", "day", "way", "may", "use", "one", "two",
  // 技术通用词
  "api", "url", "html", "css", "json", "xml", "yaml", "yml", "md",
  "src", "dst", "tmp", "log", "dir", "file", "path", "root", "home",
  // Obsidian 通用词
  "tags", "alias", "aliases", "status", "domain", "created",
]);

/** 概念索引条目 */
interface ConceptEntry {
  /** 规范标题（用于生成 wikilink） */
  canonical: string;
  /** 所有可匹配的名称（标题 + 别名），小写 */
  patterns: string[];
  /** 源文件路径 */
  filePath: string;
}

/** 单个文件的变更记录 */
interface FileChange {
  /** 文件相对路径 */
  filePath: string;
  /** 补上的链接列表 */
  added: { concept: string; line: number; context: string }[];
}

/**
 * 从正文中移除 frontmatter 和代码块，返回纯文本区域的行号映射。
 * 用于判断哪些行可以安全替换。
 *
 * @param raw - 原始文件内容
 * @returns 可替换行的 Set（行号从 1 开始）
 */
function getReplaceableLines(raw: string): Set<number> {
  const lines = raw.split("\n");
  const replaceable = new Set<number>();
  let inFrontmatter = false;
  let frontmatterCount = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 检测 frontmatter 边界
    if (line.trim() === "---") {
      if (!inFrontmatter && frontmatterCount === 0) {
        inFrontmatter = true;
        frontmatterCount++;
        continue;
      }
      if (inFrontmatter) {
        inFrontmatter = false;
        frontmatterCount++;
        continue;
      }
    }

    // 检测代码块边界
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        continue;
      } else {
        inCodeBlock = false;
        continue;
      }
    }

    // 只有非 frontmatter 且非代码块的行才可替换
    if (!inFrontmatter && !inCodeBlock) {
      replaceable.add(lineNum);
    }
  }

  return replaceable;
}

/**
 * 检查某个位置的文本是否已被 wikilink 包裹
 *
 * @param line - 当前行文本
 * @param matchIndex - 匹配词在行中的起始索引
 * @param matchLen - 匹配词的长度
 * @returns 是否已被 wikilink 包裹
 */
function isAlreadyLinked(line: string, matchIndex: number, matchLen: number): boolean {
  // 向前找 [[，向后找 ]]
  const before = line.substring(0, matchIndex);
  const after = line.substring(matchIndex + matchLen);

  // 检查前面是否有未闭合的 [[
  const lastOpenBracket = before.lastIndexOf("[[");
  const lastCloseBracket = before.lastIndexOf("]]");

  // 如果 [[ 在 ]] 之后（或没有 ]]），说明当前词在 [[ 内
  if (lastOpenBracket > lastCloseBracket && lastOpenBracket !== -1) {
    // 再确认后面有 ]]
    if (after.includes("]]")) {
      return true;
    }
  }

  return false;
}

/**
 * 检查某个位置的文本是否在行内代码（`...`）中
 */
function isInInlineCode(line: string, matchIndex: number, matchLen: number): boolean {
  const before = line.substring(0, matchIndex);
  const after = line.substring(matchIndex + matchLen);

  // 计算前面未配对的反引号数量
  const backticksBefore = (before.match(/`/g) || []).length;
  // 如果前面有奇数个反引号，说明在行内代码中
  return backticksBefore % 2 === 1;
}

/**
 * 检查是否是其他 wikilink 的目标部分（如 `[[目标|别名]]` 中的别名）
 */
function isInWikilinkAlias(line: string, matchIndex: number): boolean {
  const before = line.substring(0, matchIndex);
  // 检查前面是否有 [[...| 但还没 ]]
  const pipeIndex = before.lastIndexOf("|");
  const openBracket = before.lastIndexOf("[[");
  const closeBracket = before.lastIndexOf("]]");

  if (pipeIndex > openBracket && pipeIndex > closeBracket && openBracket !== -1) {
    return true;
  }
  return false;
}

/**
 * 执行双链补全扫描
 *
 * @param ctx - CLI 上下文
 * @param opts - 命令选项
 * @returns 变更记录数组
 */
async function runBacklinkScan(
  ctx: { vault: { root: string; scan: Function } },
  opts: { dir: string; minLen: string; maxPerFile: string; dryRun: boolean; json: boolean }
): Promise<FileChange[]> {
  const vaultRoot = ctx.vault.root;
  const targetDir = opts.dir;
  const minLen = parseInt(opts.minLen, 10);
  const maxPerFile = parseInt(opts.maxPerFile, 10);

  // ─── Step 1: 扫描所有 Permanent 页面，构建概念索引 ───
  console.log("📊 Step 1: Building concept index from vault pages...\n");

  const allPages = await ctx.vault.scan({
    includeDirs: [targetDir],
    excludeDirs: ["00-Inbox"],
  });

  const concepts: ConceptEntry[] = [];
  const titleToCanonical = new Map<string, string>(); // 小写 → 规范标题

  for (const page of allPages) {
    // 标题长度检查
    if (page.title.length < minLen) continue;
    // 跳过纯数字标题
    if (/^\d+$/.test(page.title.trim())) continue;
    // 跳过停用词
    if (STOPWORDS.has(page.title.toLowerCase())) continue;

    const patterns: string[] = [];

    // 标题（小写）
    patterns.push(page.title.toLowerCase());

    // 别名（小写）
    for (const alias of page.aliases) {
      if (alias.length >= minLen && !/^\d+$/.test(alias.trim()) && !STOPWORDS.has(alias.toLowerCase())) {
        patterns.push(alias.toLowerCase());
      }
    }

    if (patterns.length > 0) {
      const entry: ConceptEntry = {
        canonical: page.title,
        patterns,
        filePath: page.filePath,
      };
      concepts.push(entry);

      for (const p of patterns) {
        titleToCanonical.set(p, page.title);
      }
    }
  }

  console.log(`   Found ${concepts.length} concepts with ${titleToCanonical.size} total patterns\n`);

  // ─── Step 2: 构建匹配正则 ───
  // 按长度降序排列，优先匹配长词（避免 "AI" 误匹配 "AI Agent" 中的 "AI"）
  const allPatterns = [...titleToCanonical.keys()]
    .sort((a, b) => b.length - a.length);

  // 用 | 连接所有模式，用 \b 做词边界（中文不需要 \b，用前后非字母数字做边界）
  // 对中文字符，直接匹配即可（中文没有 word boundary 概念）
  // 对英文字符，用 (?<![a-zA-Z]) 和 (?![a-zA-Z]) 做边界
  const escapedPatterns = allPatterns.map(p =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  // 创建正则：对每个模式，英文用字母边界，中文直接匹配
  const patternRegexes = escapedPatterns.map(p => {
    const hasLatin = /[a-zA-Z]/.test(p);
    if (hasLatin) {
      // 包含拉丁字符：用字母边界
      return new RegExp(`(?<![a-zA-Z])${p}(?![a-zA-Z])`, "gi");
    } else {
      // 纯中文/数字：直接匹配
      return new RegExp(p, "gi");
    }
  });

  // ─── Step 3: 遍历文件，查找并替换 ───
  console.log("🔍 Step 2: Scanning files for unlinked mentions...\n");

  const changes: FileChange[] = [];
  let totalFilesScanned = 0;
  let totalAdditions = 0;

  // 重新扫描目标目录下所有文件（包括非 concept 类型的文件）
  const files = await ctx.vault.scan({
    includeDirs: [targetDir],
    excludeDirs: ["00-Inbox"],
  });

  for (const page of files) {
    const absPath = path.join(vaultRoot, page.filePath);
    const raw = fs.readFileSync(absPath, "utf-8");
    const { data, content } = matter(raw);

    totalFilesScanned++;

    // 获取可替换行
    const replaceableLines = getReplaceableLines(raw);
    const contentLines = content.split("\n");

    // 计算 content 第一行在 raw 中的行号偏移
    const rawLines = raw.split("\n");
    const contentStartLine = rawLines.findIndex(l => l === contentLines[0]) + 1 || rawLines.length - contentLines.length + 1;

    const fileChanges: { concept: string; line: number; context: string }[] = [];
    const replacedInFile = new Set<string>(); // 每个概念只替换一次

    // 对每个概念模式进行匹配
    for (let ci = 0; ci < allPatterns.length; ci++) {
      const pattern = allPatterns[ci];
      const canonical = titleToCanonical.get(pattern)!;

      // 跳过自引用（文件引用自己的标题）
      if (canonical === page.title) continue;
      if (replacedInFile.has(canonical)) continue;
      if (fileChanges.length >= maxPerFile) break;

      const regex = patternRegexes[ci];

      for (let lineIdx = 0; lineIdx < contentLines.length; lineIdx++) {
        const line = contentLines[lineIdx];
        const rawLineNum = contentStartLine + lineIdx;

        // 检查该行是否可替换
        if (!replaceableLines.has(rawLineNum)) continue;

        // 重置 regex 的 lastIndex
        regex.lastIndex = 0;
        const match = regex.exec(line);
        if (!match) continue;

        const matchIndex = match.index;
        const matchText = match[0];

        // 检查是否已被 wikilink 包裹
        if (isAlreadyLinked(line, matchIndex, matchText.length)) continue;

        // 检查是否在行内代码中
        if (isInInlineCode(line, matchIndex, matchText.length)) continue;

        // 检查是否在 wikilink 别名部分
        if (isInWikilinkAlias(line, matchIndex)) continue;

        // 找到一个需要补链接的位置
        const contextStart = Math.max(0, matchIndex - 15);
        const contextEnd = Math.min(line.length, matchIndex + matchText.length + 15);
        const context = (contextStart > 0 ? "..." : "") +
          line.substring(contextStart, contextEnd) +
          (contextEnd < line.length ? "..." : "");

        fileChanges.push({
          concept: canonical,
          line: rawLineNum,
          context: context.trim(),
        });

        replacedInFile.add(canonical);
        totalAdditions++;

        // 执行替换（在原始行上）
        const newLine = line.substring(0, matchIndex) +
          `[[${canonical}]]` +
          line.substring(matchIndex + matchText.length);
        contentLines[lineIdx] = newLine;

        break; // 该概念已处理，跳出行循环
      }
    }

    // 如果有变更，写回文件
    if (fileChanges.length > 0) {
      changes.push({ filePath: page.filePath, added: fileChanges });

      if (!opts.dryRun) {
        // 重建文件内容：frontmatter + 修改后的正文
        const newContent = matter.stringify(contentLines.join("\n"), data);
        fs.writeFileSync(absPath, newContent, "utf-8");
      }
    }
  }

  return changes;
}

/**
 * @description 创建 backlink-scan 子命令
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function backlinkScanCommand(): Command {
  return new Command("backlink-scan")
    .description(
      "Scan vault for unlinked concept mentions and add [[wikilinks]]. " +
      "Only processes 50-Knowledge/, skips Inbox."
    )
    .option("--dir <name>", "Target directory to scan", "50-Knowledge")
    .option("--min-len <n>", "Minimum concept name length to match", "2")
    .option("--max-per-file <n>", "Max links to add per file per run", "20")
    .option("--dry-run", "Preview changes without writing", false)
    .option("--json", "Output as JSON", false)
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      console.log("\n🔗 Backlink Scan\n");
      row("Vault", ctx.vault.root, "36");
      row("Target dir", opts.dir, "36");
      row("Min name length", opts.minLen, "36");
      row("Max per file", opts.maxPerFile, "36");
      row("Mode", opts.dryRun ? "🔍 dry-run (preview)" : "✏️  write", opts.dryRun ? "33" : "32");
      console.log();

      const changes = await runBacklinkScan(ctx, opts);

      // JSON 输出
      if (opts.json) {
        console.log(JSON.stringify(changes, null, 2));
        process.exit(0);
      }

      // 人类可读输出
      if (changes.length === 0) {
        console.log("✅ All concepts are already linked!\n");
      } else {
        console.log(`═══ ${opts.dryRun ? "Would add" : "Added"} links ═══\n`);
        for (const file of changes) {
          console.log(`📄 ${file.filePath}`);
          for (const add of file.added) {
            console.log(`  🔗 L${add.line}: [[${add.concept}]]`);
            console.log(`     ${add.context}`);
          }
          console.log();
        }
      }

      // 统计汇总
      const totalAdded = changes.reduce((sum, c) => sum + c.added.length, 0);
      console.log("═══════════════════════════════");
      row("Files with changes", changes.length, changes.length > 0 ? "33" : "32");
      row("Total links added", totalAdded, totalAdded > 0 ? "33" : "32");
      console.log();

      if (opts.dryRun && totalAdded > 0) {
        console.log("💡 Run without --dry-run to apply changes.\n");
      }
    });
}
