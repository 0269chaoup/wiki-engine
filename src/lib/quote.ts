/**
 * @file 语录管理逻辑模块
 *
 * 管理 Obsidian vault 中的语录文件（拾慧.md）。
 * 提供语录的读取、解析、追加和列表功能。
 *
 * 语录格式：
 * ```
 * > "语录内容"
 * >
 * > — 来源：出处, 日期
 * ```
 *
 * 语录文件路径：50-Knowledge/拾慧.md
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";

/**
 * 语录接口
 * 表示一条独立的语录记录
 */
export interface Quote {
  /** 语录正文 */
  text: string;
  /** 来源（作者、书籍、演讲等） */
  source: string;
  /** 日期（YYYY-MM-DD 格式） */
  date: string;
  /** 关联标签列表 */
  tags: string[];
}

/**
 * 语录文件接口
 * 表示整个语录文件的解析结果
 */
export interface QuoteFile {
  /** 解析出的所有语录列表 */
  quotes: Quote[];
  /** 文件的 frontmatter 元数据 */
  frontmatter: Record<string, unknown>;
  /** 文件原始内容 */
  rawContent: string;
}

/**
 * 语录文件相对于 vault 根目录的路径
 */
const QUOTE_FILE_RELATIVE = "50-Knowledge/拾慧.md";

/**
 * @description 获取语录文件的绝对路径
 *
 * @param vaultRoot - vault 根目录路径
 * @returns 语录文件的绝对路径
 */
export function getQuoteFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, QUOTE_FILE_RELATIVE);
}

/**
 * @description 读取并解析语录文件
 *
 * 使用 gray-matter 分离 frontmatter，然后从正文中解析出所有语录条目。
 * 如果文件不存在，返回空结果。
 *
 * @param vaultRoot - vault 根目录路径
 * @returns 语录文件解析结果
 */
export function readQuotes(vaultRoot: string): QuoteFile {
  const filePath = getQuoteFilePath(vaultRoot);
  if (!fs.existsSync(filePath)) {
    return { quotes: [], frontmatter: {}, rawContent: "" };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let data: Record<string, unknown>;
  try {
    ({ data } = matter(raw));
  } catch {
    data = {};
  }

  /** 从正文内容中解析语录 */
  const quotes = parseQuotesFromContent(raw);

  return { quotes, frontmatter: data, rawContent: raw };
}

/**
 * @description 从 Markdown 内容中解析语录条目
 *
 * 支持两种格式：
 * 1. 单行引用块：> "语录内容"\n\n— 来源：出处, 日期
 * 2. 多行引用块：> "语录内容"\n>\n> — 来源：出处, 日期
 *
 * @param content - 原始 Markdown 内容
 * @returns 解析出的语录数组
 */
function parseQuotesFromContent(content: string): Quote[] {
  const quotes: Quote[] = [];
  /** 匹配模式：引用块中的语录 + 来源行 */
  const regex = />\s*"([\s\S]+?)"\s*\n[\s>]*\n[\s>]*—\s*来源[：:]\s*(.+?)(?:,\s*(\d{4}-\d{2}-\d{2}))?\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    quotes.push({
      text: m[1].trim(),
      source: m[2].trim(),
      date: m[3] ?? "",
      tags: [],
    });
  }
  return quotes;
}

/**
 * @description 向语录文件追加一条新语录
 *
 * 追加流程：
 * 1. 检查文件是否存在
 * 2. 检查是否重复（基于前 50 个字符匹配）
 * 3. 构建语录块
 * 4. 在 "*最后更新*" 标记前插入（或追加到文件末尾）
 * 5. 更新 "*最后更新*" 时间戳
 *
 * @param vaultRoot - vault 根目录路径
 * @param quote - 要追加的语录对象
 * @returns 操作结果：成功/失败及详细信息
 */
export function appendQuote(
  vaultRoot: string,
  quote: Quote
): { success: boolean; detail: string } {
  const filePath = getQuoteFilePath(vaultRoot);

  if (!fs.existsSync(filePath)) {
    return { success: false, detail: `Quotes file not found: ${filePath}` };
  }

  const raw = fs.readFileSync(filePath, "utf-8");

  /** 重复检测：基于语录前 50 个字符 */
  if (raw.includes(quote.text.slice(0, 50))) {
    return { success: false, detail: "Quote already exists (duplicate detected)" };
  }

  /** 构建语录块 */
  const datePart = quote.date ? `, ${quote.date}` : `, ${new Date().toISOString().slice(0, 10)}`;
  const sourcePart = quote.source ? quote.source : "未知来源";
  const newBlock = `\n> "${quote.text}"\n>\n> — 来源：${sourcePart}${datePart}\n`;

  /** 在 "*最后更新*" 标记前插入，或追加到文件末尾 */
  let updated: string;
  const lastUpdateMatch = raw.match(/\*最后更新[：:].+?\*\s*$/m);
  if (lastUpdateMatch) {
    const insertPos = raw.lastIndexOf(lastUpdateMatch[0]);
    updated = raw.slice(0, insertPos) + newBlock.trimEnd() + "\n\n" + raw.slice(insertPos);
  } else {
    updated = raw.trimEnd() + "\n\n---\n" + newBlock;
  }

  /** 更新 "*最后更新*" 时间戳 */
  const today = new Date().toISOString().slice(0, 10);
  updated = updated.replace(
    /\*最后更新[：:].+?\*/,
    `*最后更新：${today}*`
  );

  fs.writeFileSync(filePath, updated, "utf-8");
  return { success: true, detail: `Quote added to ${QUOTE_FILE_RELATIVE}` };
}

/**
 * @description 列出所有语录
 *
 * @param vaultRoot - vault 根目录路径
 * @returns 语录数组
 */
export function listQuotes(vaultRoot: string): Quote[] {
  const { quotes } = readQuotes(vaultRoot);
  return quotes;
}
