import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface Quote {
  text: string;
  source: string;
  date: string;
  tags: string[];
}

export interface QuoteFile {
  quotes: Quote[];
  frontmatter: Record<string, unknown>;
  rawContent: string;
}

const QUOTE_FILE_RELATIVE = "50-Knowledge/拾慧.md";

/** Get the absolute path to the quotes file */
export function getQuoteFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, QUOTE_FILE_RELATIVE);
}

/** Read and parse the quotes file */
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

  // Parse quotes from the content body
  const quotes = parseQuotesFromContent(raw);

  return { quotes, frontmatter: data, rawContent: raw };
}

/** Parse existing quotes from the markdown content */
function parseQuotesFromContent(content: string): Quote[] {
  const quotes: Quote[] = [];
  // Format: > "text"\n\n— 来源：source, date
  // Also handle: > "text"\n>\n> — 来源：source, date
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

/** Append a new quote to the quotes file */
export function appendQuote(
  vaultRoot: string,
  quote: Quote
): { success: boolean; detail: string } {
  const filePath = getQuoteFilePath(vaultRoot);

  if (!fs.existsSync(filePath)) {
    return { success: false, detail: `Quotes file not found: ${filePath}` };
  }

  const raw = fs.readFileSync(filePath, "utf-8");

  // Check for duplicate
  if (raw.includes(quote.text.slice(0, 50))) {
    return { success: false, detail: "Quote already exists (duplicate detected)" };
  }

  // Build the new quote block
  const datePart = quote.date ? `, ${quote.date}` : `, ${new Date().toISOString().slice(0, 10)}`;
  const sourcePart = quote.source ? quote.source : "未知来源";
  const newBlock = `\n> "${quote.text}"\n>\n> — 来源：${sourcePart}${datePart}\n`;

  // Find insertion point — before the last "*最后更新*" line, or at end
  let updated: string;
  const lastUpdateMatch = raw.match(/\*最后更新[：:].+?\*\s*$/m);
  if (lastUpdateMatch) {
    const insertPos = raw.lastIndexOf(lastUpdateMatch[0]);
    updated = raw.slice(0, insertPos) + newBlock.trimEnd() + "\n\n" + raw.slice(insertPos);
  } else {
    updated = raw.trimEnd() + "\n\n---\n" + newBlock;
  }

  // Update the "最后更新" timestamp
  const today = new Date().toISOString().slice(0, 10);
  updated = updated.replace(
    /\*最后更新[：:].+?\*/,
    `*最后更新：${today}*`
  );

  fs.writeFileSync(filePath, updated, "utf-8");
  return { success: true, detail: `Quote added to ${QUOTE_FILE_RELATIVE}` };
}

/** List all quotes */
export function listQuotes(vaultRoot: string): Quote[] {
  const { quotes } = readQuotes(vaultRoot);
  return quotes;
}
