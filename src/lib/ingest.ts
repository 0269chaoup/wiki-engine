import type { LLMProvider } from "../llm/provider.js";
import { parseJSON } from "../llm/provider.js";
import type { ExtractedEntity, ExtractedEvent, ExtractedStory, PageType } from "./types.js";
import { PAGE_TYPES } from "./types.js";

/**
 * Two-step ingest pipeline (ported from llm_wiki).
 *
 * Step 1: Analyze source → extract entities, events, concepts (with key quotes)
 * Step 2: Generate wiki pages from extracted data + source text
 *
 * When using pipe provider, Step 1 output is visible in chat (visualization).
 */

// ─── Step 1: Analysis ──────────────────────────────────────────────

const ANALYZE_SYSTEM = `You are a knowledge extraction engine.
Given a text, extract ALL notable entities, events, and concepts.
Be thorough but precise. Each extraction must be meaningful.
For each extraction, also capture key quotes and specific data from the source.
Always respond in valid JSON.`;

const ANALYZE_PROMPT = (text: string) => `Extract knowledge from the following text.
Return JSON with this structure:
{
  "entities": [
    {
      "name": "entity name",
      "type": "entity|concept",
      "description": "2-3 sentence description",
      "tags": ["relevant", "tags"],
      "relations": [{"target": "other entity name", "relation": "relationship description"}],
      "keyQuotes": ["important direct quotes or specific data about this entity from the source"]
    }
  ],
  "events": [
    {
      "name": "event name",
      "description": "what happened",
      "time": "when (if mentioned)",
      "location": "where (if mentioned)",
      "participants": ["who was involved"],
      "tags": ["relevant", "tags"],
      "relatedWikis": ["related entity/concept names"],
      "keyQuotes": ["important quotes or data about this event from the source"]
    }
  ],
  "concepts": [
    {
      "name": "concept name",
      "description": "explanation of the concept",
      "tags": ["relevant", "tags"],
      "relations": [{"target": "related concept", "relation": "how they relate"}],
      "keyQuotes": ["important quotes explaining this concept from the source"]
    }
  ]
}

Text to analyze:
---
${text}
---

Respond ONLY with the JSON. No explanation.`;

// ─── Step 2: Page Generation ───────────────────────────────────────

const GENERATE_SYSTEM = `你是一位深挖细节的档案学者，而非做摘要的秘书。你的任务是撰写具有百科全书深度的知识专著。

三条生成法则（必须严格遵守）：
1. 禁止单纯概括：每个核心观点必须展开至少 2-3 个层次的逻辑推演。不要只写一句话的结论，要写出推导过程。
2. 强制原文锚定：每一段论述，必须辅以源材料中的具体数据、案例、甚至人物原话。使用 > 📜 原文考据： 语法将这些细节直接引用在正文中。没有原文支撑的论述是无效的。
3. 结构化容器：必须使用 Obsidian 原生的 Callout 语法（如 > [!info] 背景、> [!danger] 核心冲突、> [!tip] 动机拆解）和分级标题（H2/H3/H4）来组织信息密度，确保长文的可读性。

使用与源材料相同的语言写作。始终以有效的 JSON 格式回复。`;

// ─── Story Blueprint ───────────────────────────────────────────────

const STORY_PROMPT = (text: string, sourceTitle: string, eventNames: string[]) => `从以下源材料中创建一个 Story 页面。Story 提供"上帝视角"——它不需要重复 Event 的细节，而是要提炼出驱动这些事件背后的结构性力量。

## 内容模具（必须填满每个模块）

### A. 核心叙事弧
详细描写这段历史/业务的主线。起点是什么？终点在哪里？中间经历了哪几次关键的范式转移？
要求：不低于 300 字的叙事段落，必须有具体的年份、人物、事件细节。

### B. 核心矛盾与动力
剖析背后的利益博弈、思想冲突或技术演进。是谁在推动？阻力来自哪里？
要求：使用 > [!danger] 核心冲突 容器，必须引用源材料中的具体案例。

### C. 演化时间轴
输出一段 Dataview 代码块，动态查询所有相关事件。

### D. 关键见解
基于全局材料，提炼出 1-2 个反直觉的洞察。
要求：列表 + 粗体强调，每个洞察必须有原文支撑。

## 强制使用这些事件名称作为 [[wikilinks]]：
${eventNames.map(n => `- [[${n}]]`).join('\n')}

源材料：${sourceTitle}
---
${text}
---

返回 JSON：
{
  "title": "故事的标题",
  "content": "完整的 Markdown 内容（包含所有模块 A-D）",
  "events": [${eventNames.map(n => `"${n}"`).join(', ')}],
  "relatedWikis": ["故事中链接的实体/概念名称"],
  "tags": ["相关标签"]
}

只返回 JSON，不要其他内容。`;

// ─── Entity Blueprint ──────────────────────────────────────────────

const ENTITY_PROMPT = (item: { name: string; description: string; tags: string[] }, sourceText: string) => `为以下实体生成一个丰满的 Wiki 页面。这不是摘要——这是一个立体档案。

实体名称：${item.name}
初步描述：${item.description}
标签：${item.tags.join(", ")}

## 源材料（必须从中提取原文考据）：
---
${sourceText}
---

## 内容模具（必须填满每个模块）

### A. 身份与起源
详细描写该实体在源材料语境下的核心身份、背景和成长轨迹。
要求：不低于 200 字，必须包含具体的时间线和关键转折点。

### B. 核心主张/行事风格
提取该实体的行事逻辑、信奉的思想体系。使用 [[wikilinks]] 链接到相关概念。
要求：用 H3 标题展开论述，每个主张必须有源材料中的具体例证。

### C. 权力/关系网络
详细拆解该实体与材料中其他实体的关系（如：投资、师生、对抗）。具体是如何互动的？
要求：列表形式，每条关系必须包含 [[wikilinks]] 和具体的互动细节。

### D. 关键言论
摘录源材料中该实体的标志性原话。
要求：使用 > 🗣️ 关键言论：引用块，至少 1-2 条原文引用。

返回 JSON：
{
  "frontmatter": { "title": "${item.name}", "type": "entity", "tags": ${JSON.stringify(item.tags)}, "aliases": [] },
  "content": "完整的 Markdown 内容（包含所有模块 A-D，使用 ## 关联 作为关联部分标题）"
}

只返回 JSON，不要其他内容。`;

// ─── Event Blueprint ───────────────────────────────────────────────

const EVENT_PROMPT = (item: { name: string; description: string; tags: string[]; time?: string; location?: string; participants?: string[] }, sourceText: string) => `为以下事件生成一个高分辨率的复盘页面。绝不能只写一句话"某年某月发生了某事"，必须提供丰富的现场感。

事件名称：${item.name}
事件描述：${item.description}
时间：${item.time || "未知"}
地点：${item.location || "未知"}
参与者：${item.participants?.join(", ") || "未知"}
标签：${item.tags.join(", ")}

## 源材料（必须从中提取原文考据）：
---
${sourceText}
---

## 内容模具（必须填满每个模块）

### A. 现场还原
像写纪实文学一样，详细还原事件发生的具体时间、地点、人物动作及经过。
要求：不低于 200 字的记叙文段落，必须有画面感。

### B. 决策动机
深入分析：发起该事件的实体，其表层理由是什么？深层战略考量是什么？受什么理念驱动（使用 [[wikilinks]] 链接概念）？
要求：使用 > [!tip] 动机拆解 容器，必须引用源材料中的具体证据。

### C. 连锁反应
该事件在当时引发了什么争议？对后续的哪个 [[事件]] 产生了直接影响？
要求：H3 子标题模块，必须使用 [[wikilinks]] 链接相关事件和实体。

### D. 原文快照
从源材料中提取一段最能反映该事件张力的金句或原始数据段落。
要求：使用 > 📜 原文：引用块。

返回 JSON：
{
  "frontmatter": { "title": "${item.name}", "type": "event", "tags": ${JSON.stringify(item.tags)}, "time": "${item.time || ''}", "location": "${item.location || ''}", "participants": ${JSON.stringify(item.participants || [])} },
  "content": "完整的 Markdown 内容（包含所有模块 A-D，使用 ## 关联 作为关联部分标题）"
}

只返回 JSON，不要其他内容。`;

// ─── Concept Blueprint ─────────────────────────────────────────────

const CONCEPT_PROMPT = (item: { name: string; description: string; tags: string[] }, sourceText: string) => `为以下概念生成一个深度解析的 Wiki 页面。概念不是一句话定义，而是一个需要多维度拆解的知识框架。

概念名称：${item.name}
初步描述：${item.description}
标签：${item.tags.join(", ")}

## 源材料（必须从中提取原文考据）：
---
${sourceText}
---

## 内容模具（必须填满每个模块）

### A. 核心定义与起源
详细解释这个概念的内涵、起源和演变。
要求：不低于 150 字，必须说明概念的来源和提出者。

### B. 理论框架
拆解这个概念的核心组成部分或关键原理。
要求：使用 H3 子标题，每个部分必须有源材料中的具体例证。

### C. 实践应用
这个概念在源材料的语境中是如何被应用的？产生了什么效果？
要求：必须引用源材料中的具体案例，使用 > 📜 原文考据： 锚定。

### D. 与其他概念的关联
这个概念与材料中其他概念有何关系？是互补、对立还是衍生？
要求：使用 [[wikilinks]] 链接相关概念，每条关系必须有解释。

返回 JSON：
{
  "frontmatter": { "title": "${item.name}", "type": "concept", "tags": ${JSON.stringify(item.tags)}, "aliases": [] },
  "content": "完整的 Markdown 内容（包含所有模块 A-D，使用 ## 关联 作为关联部分标题）"
}

只返回 JSON，不要其他内容。`;

// ─── Ingest Pipeline ───────────────────────────────────────────────

export interface IngestResult {
  entities: ExtractedEntity[];
  events: ExtractedEvent[];
  stories: ExtractedStory[];
  pages: { frontmatter: Record<string, any>; content: string }[];
}

/**
 * Run the full ingest pipeline on a text.
 * Returns structured data + generated page content.
 */
export async function ingestText(
  text: string,
  llm: LLMProvider,
  sourceTitle: string,
  opts?: { skipStory?: boolean; generatePages?: boolean }
): Promise<IngestResult> {
  const result: IngestResult = { entities: [], events: [], stories: [], pages: [] };

  // Step 1: Analyze
  const analysisRaw = await llm.complete(ANALYZE_PROMPT(text), ANALYZE_SYSTEM);
  const analysis = parseJSON<{ entities: ExtractedEntity[]; events: ExtractedEvent[]; concepts: ExtractedEntity[] }>(analysisRaw.content);

  result.entities = [...(analysis.entities ?? []), ...(analysis.concepts ?? [])];
  result.events = analysis.events ?? [];

  // 提取事件名称列表（作为权威来源）
  const eventNames = result.events.map(e => e.name);

  // Step 2: Generate Story (optional)
  if (!opts?.skipStory) {
    try {
      const storyRaw = await llm.complete(STORY_PROMPT(text, sourceTitle, eventNames), GENERATE_SYSTEM);
      const story = parseJSON<ExtractedStory>(storyRaw.content);
      story.sourceTitle = sourceTitle;
      result.stories.push(story);
    } catch (e) {
      console.error("Story generation failed:", (e as Error).message);
    }
  }

  // Step 3: Generate wiki pages with source text (optional)
  if (opts?.generatePages !== false) {
    // Truncate source text if too long (keep first 8000 chars for context window)
    const truncatedSource = text.length > 8000 ? text.slice(0, 8000) + "\n\n[... 源材料已截断 ...]" : text;

    for (const entity of result.entities) {
      try {
        const itemType = entity.type === "concept" ? "concept" : "entity";
        const prompt = itemType === "concept"
          ? CONCEPT_PROMPT({ name: entity.name, description: entity.description, tags: entity.tags }, truncatedSource)
          : ENTITY_PROMPT({ name: entity.name, description: entity.description, tags: entity.tags }, truncatedSource);
        const pageRaw = await llm.complete(prompt, GENERATE_SYSTEM);
        const page = parseJSON(pageRaw.content);

        // 强制使用 Step 1 的 name 作为文件名
        if (page.frontmatter) {
          page.frontmatter.title = entity.name;
        }

        result.pages.push(page);
      } catch (e) {
        console.error(`Page generation failed for ${entity.name}:`, (e as Error).message);
      }
    }

    for (const event of result.events) {
      try {
        const prompt = EVENT_PROMPT({
          name: event.name,
          description: event.description,
          tags: event.tags,
          time: event.time,
          location: event.location,
          participants: event.participants,
        }, truncatedSource);
        const pageRaw = await llm.complete(prompt, GENERATE_SYSTEM);
        const page = parseJSON(pageRaw.content);

        // 强制使用 Step 1 的 name 作为文件名
        if (page.frontmatter) {
          page.frontmatter.title = event.name;
        }

        result.pages.push(page);
      } catch (e) {
        console.error(`Page generation failed for ${event.name}:`, (e as Error).message);
      }
    }
  }

  return result;
}

/**
 * Build the analysis prompt WITHOUT executing it.
 * Used by pipe mode to show the prompt first.
 */
export function buildAnalyzePrompt(text: string): { system: string; prompt: string } {
  return { system: ANALYZE_SYSTEM, prompt: ANALYZE_PROMPT(text) };
}

export function buildStoryPrompt(text: string, sourceTitle: string): { system: string; prompt: string } {
  return { system: GENERATE_SYSTEM, prompt: STORY_PROMPT(text, sourceTitle, []) };
}
