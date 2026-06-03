/**
 * @file 文档创建逻辑模块
 *
 * 在 Obsidian vault 的 Permanent 目录下创建新的知识文件。
 * 支持四种页面类型：Story、Event、Entity、Concept。
 *
 * 每种类型都有预定义的模板结构，包含：
 * - YAML frontmatter（标题、类型、领域、标签等）
 * - 归档信息块（Tags、Keywords、One-Liner）
 * - 正文模板（按类型有不同的章节结构）
 *
 * 创建后自动同步到对应的 MOC 文件。
 */

import fs from "fs";
import path from "path";
import { syncFileToMoc } from "./moc-sync.js";

/**
 * 创建选项接口
 * 配置新知识文件的元数据参数
 */
export interface CreateOptions {
  /** 页面类型：Story/Event/Entity/Concept */
  type: "Story" | "Event" | "Entity" | "Concept";
  /** 知识领域（如 "AI与大模型"、"软件开发"） */
  domain: string;
  /** 页面标题 */
  title: string;
  /** 标签列表（可选，默认根据类型和领域自动生成） */
  tags?: string[];
  /** 来源信息（可选） */
  source?: string;
  /** 别名列表（可选） */
  aliases?: string[];
  /** 状态标记（可选） */
  status?: string;
  /** 创建日期（可选，默认为当天） */
  created?: string;
}

/**
 * 页面类型 → 目录名映射表
 * Permanent 目录下按类型分目录存放
 */
const DIRECTORY_MAP: Record<string, string> = {
  Story: "Stories",
  Event: "Events",
  Entity: "Entities",
  Concept: "Concepts",
};

/**
 * @description 生成 YAML frontmatter 字符串
 *
 * 构建包含 title、type、domain、tags、created 等字段的 frontmatter。
 * tags 字段如果未提供，则根据类型和领域自动生成。
 *
 * @param opts - 创建选项
 * @returns 格式化的 YAML frontmatter 字符串（含 "---" 分隔符）
 */
function buildFrontmatter(opts: CreateOptions): string {
  const lines: string[] = ["---"];
  lines.push(`title: "${opts.title}"`);
  lines.push(`type: ${opts.type}`);
  lines.push(`domain: ${opts.domain}`);

  /** 标签：优先使用用户提供的，否则自动生成 */
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
 * @description 生成归档信息块
 *
 * 输出格式化的 Obsidian callout 块，包含 Tags、Keywords、One-Liner 字段。
 * 供用户在编辑时填写。
 *
 * @param opts - 创建选项
 * @returns 归档信息块的 Markdown 内容
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
 * @description 根据页面类型生成模板正文
 *
 * 每种类型有不同的章节结构：
 * - Story：核心叙事弧、核心冲突、演化时间轴、关键洞察
 * - Event：现场还原、动机拆解、连锁反应、历史原声、关联图谱
 * - Entity：身份与演变、核心主张、权力网络、标志性言论
 * - Concept：追问其本、建立直觉、系统化认知、思想溯源、知识成图
 *
 * @param opts - 创建选项
 * @returns 模板正文的 Markdown 内容
 */
function buildBody(opts: CreateOptions): string {
  const templates: Record<string, string> = {
    /** Story 模板：叙事性内容的"上帝视角" */
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

    /** Event 模板：高分辨率的事件复盘 */
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

    /** Entity 模板：立体化的实体档案 */
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

    /** Concept 模板：多维度拆解的概念解析 */
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
 * @description 在 vault 中创建新的知识文件
 *
 * 创建流程：
 * 1. 根据类型确定目标目录（50-Knowledge/Permanent/{type}/）
 * 2. 检查文件是否已存在
 * 3. 构建完整内容（frontmatter + 归档信息块 + 模板正文）
 * 4. 写入文件
 * 5. 异步同步到对应的 MOC 文件
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 创建选项
 * @returns 创建结果：成功/失败、文件路径、详细信息
 */
export function createKnowledgeFile(
  vaultRoot: string,
  opts: CreateOptions
): { success: boolean; filePath: string; detail: string } {
  /** 根据类型确定目标目录 */
  const dir = DIRECTORY_MAP[opts.type] ?? "Concepts";
  /** 清理文件名中的非法字符 */
  const fileName = `${opts.title.replace(/[\/\\:*?"<>|]/g, "_")}.md`;
  const relativePath = `50-Knowledge/Permanent/${dir}/${fileName}`;
  const abs = path.join(vaultRoot, relativePath);

  /** 检查文件是否已存在 */
  if (fs.existsSync(abs)) {
    return { success: false, filePath: relativePath, detail: "File already exists" };
  }

  /** 确保目标目录存在 */
  const dirPath = path.dirname(abs);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /** 构建完整文件内容 */
  const frontmatter = buildFrontmatter(opts);
  const archive = buildArchiveBlock(opts);
  const body = buildBody(opts);
  const content = frontmatter + "\n" + archive + "\n" + body + "\n";

  fs.writeFileSync(abs, content, "utf-8");

  /** 异步同步到 MOC（不阻塞主流程） */
  syncFileToMoc(vaultRoot, relativePath).catch(() => {});

  return { success: true, filePath: relativePath, detail: `Created ${relativePath}` };
}
