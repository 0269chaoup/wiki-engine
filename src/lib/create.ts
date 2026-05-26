import fs from "fs";
import path from "path";
import { syncFileToMoc } from "./moc-sync.js";

export interface CreateOptions {
  type: "Story" | "Event" | "Entity" | "Concept";
  domain: string;
  title: string;
  tags?: string[];
  source?: string;
  aliases?: string[];
  status?: string;
  created?: string;
}

const DIRECTORY_MAP: Record<string, string> = {
  Story: "Stories",
  Event: "Events",
  Entity: "Entities",
  Concept: "Concepts",
};

/**
 * Generate frontmatter YAML string.
 */
function buildFrontmatter(opts: CreateOptions): string {
  const lines: string[] = ["---"];
  lines.push(`title: "${opts.title}"`);
  lines.push(`type: ${opts.type}`);
  lines.push(`domain: ${opts.domain}`);

  if (opts.tags?.length) {
    lines.push(`tags: [${opts.tags.join(", ")}]`);
  } else {
    lines.push(`tags: [${opts.type.toLowerCase()}, ${opts.domain}]`);
  }

  lines.push(`created: ${opts.created ?? new Date().toISOString().slice(0, 10)}`);

  if (opts.source) lines.push(`source: "${opts.source}"`);
  if (opts.aliases?.length) lines.push(`aliases: [${opts.aliases.map(a => `"${a}"`).join(", ")}]`);
  if (opts.status) lines.push(`status: ${opts.status}`);

  lines.push("---");
  return lines.join("\n");
}

/**
 * Generate 归档信息 block.
 */
function buildArchiveBlock(opts: CreateOptions): string {
  const tags = opts.tags?.length ? opts.tags : [opts.type.toLowerCase(), opts.domain];
  const tagStr = tags.map(t => `#${t}`).join(" ");

  return [
    "",
    `> 🗂️ **归档信息**`,
    `>`,
    `> - **Tags**: ${tagStr}`,
    `> - **Keywords**: [[关键词1]], [[关键词2]]`,
    `> - **One-Liner**: [一句话概括]`,
    "",
  ].join("\n");
}

/**
 * Generate template body based on type.
 */
function buildBody(opts: CreateOptions): string {
  const templates: Record<string, string> = {
    Story: [
      `# ${opts.title}`,
      "",
      "## 📖 核心叙事弧",
      "",
      "[≥300 字的详细叙事]",
      "",
      "> [!danger] 核心冲突",
      "> [冲突分析]",
      '> 📜 **原文考据**："原文引用"',
      "",
      "## ⏳ 演化时间轴 (Timeline)",
      "",
      "```dataview",
      "TABLE",
      '  date AS "时间",',
      '  file.outlinks AS "涉及实体/概念"',
      'FROM "50-Knowledge/Permanent/Events"',
      "WHERE contains(file.inlinks, this.file.link)",
      "SORT date ASC",
      "```",
      "",
      "## 🧠 关键洞察",
      "",
      "- **洞察一**：[推演结论]",
      "- **洞察二**：[延伸观点]",
    ].join("\n"),

    Event: [
      `# ${opts.title}`,
      "",
      "## 🎬 现场还原",
      "",
      "[≥200 字的纪实还原]",
      "",
      "> [!tip] 动机拆解",
      "> - **表层理由**：...",
      "> - **深层战略考量**：...",
      "> - **理念驱动**：此行为受 [[{核心概念}]] 思想驱动。",
      "",
      "## 🌊 连锁反应",
      "",
      "### 短期影响",
      "",
      "- 影响点1：...",
      "",
      "### 长期影响",
      "",
      "- 影响点1：...",
      "",
      "## 📜 历史原声",
      "",
      "> [!quote] 原文快照",
      '> "金句或原始数据段落。"',
      "",
      "## 🔗 关联图谱",
      "",
      "- **主导者**：[[实体A]]",
      "- **被影响者**：[[实体B]]",
      "- **前置事件**：[[上一个Event]]",
      "- **驱动概念**：[[核心概念]]",
    ].join("\n"),

    Entity: [
      `# ${opts.title}`,
      "",
      "## 🧬 身份与演变",
      "",
      "[≥200 字的身份与成长轨迹描写]",
      "",
      "## 🎭 核心主张与行事风格",
      "",
      "### 1. [[主张/概念A]]",
      "",
      "[行事逻辑展开]",
      "",
      '> 📜 **原文考据**："支撑此主张的具体例证或原话。"',
      "",
      "## 🕸️ 权力与关系网络",
      "",
      "- **关系类型**：[[实体A]] —— 具体互动细节",
      "",
      "## 🗣️ 标志性言论",
      "",
      "> [!quote] 核心语录",
      '> "标志性原话"',
    ].join("\n"),

    Concept: [
      `# 概念解剖：${opts.title}`,
      "",
      "## 🎯 第一步：追问其本 (The Why)",
      "",
      "**核心矛盾**：该概念是为了解决什么矛盾而存在的？",
      "",
      '> 📜 **原文考据**："...',
      "",
      "## 💡 第二步：建立直觉 (The How)",
      "",
      "> [!tip] 核心直觉",
      "> [生活化类比，3-5 句话讲透]",
      "",
      "## 🔧 第三步：系统化认知 (The What)",
      "",
      "### A. 核心构成",
      "",
      "#### 1. [[组件名称A]]",
      "",
      "- 解释与原理...",
      "",
      "### B. 应用边界与批评",
      "",
      "- **适用场景**：...",
      "- **批评与争议**：...",
      "",
      "## 🕸️ 第四步：思想溯源与现实映射",
      "",
      "- **提出者/信奉者**：[[{实体名称}]]",
      "- **历史实践案例**：在 [[{事件名称}]] 中，此概念被作为底层逻辑付诸行动。",
      "",
      "## 🗺️ 知识成图 (Mermaid)",
      "",
      "```mermaid",
      "graph LR",
      "A[组件A] -->|核心机制| B[组件B]",
      "B --> C[最终结果]",
      "```",
    ].join("\n"),
  };

  return templates[opts.type] ?? templates["Concept"];
}

/**
 * Create a new knowledge file with proper structure.
 */
export function createKnowledgeFile(
  vaultRoot: string,
  opts: CreateOptions
): { success: boolean; filePath: string; detail: string } {
  const dir = DIRECTORY_MAP[opts.type] ?? "Concepts";
  const fileName = `${opts.title.replace(/[\/\\:*?"<>|]/g, "_")}.md`;
  const relativePath = `50-Knowledge/Permanent/${dir}/${fileName}`;
  const abs = path.join(vaultRoot, relativePath);

  if (fs.existsSync(abs)) {
    return { success: false, filePath: relativePath, detail: "File already exists" };
  }

  // Ensure directory exists
  const dirPath = path.dirname(abs);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Build content
  const frontmatter = buildFrontmatter(opts);
  const archive = buildArchiveBlock(opts);
  const body = buildBody(opts);
  const content = frontmatter + "\n" + archive + "\n" + body + "\n";

  fs.writeFileSync(abs, content, "utf-8");

  // Auto-sync to MOC
  syncFileToMoc(vaultRoot, relativePath).catch(() => {});

  return { success: true, filePath: relativePath, detail: `Created ${relativePath}` };
}
