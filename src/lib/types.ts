/**
 * @file 核心类型定义模块
 *
 * 本文件定义了 wiki-engine 项目的所有核心数据类型，包括：
 * - 页面类型（WikiPage、PageType）
 * - 实体/事件/故事等提取结果类型
 * - 知识图谱类型（GraphNode、GraphEdge、Graph）
 * - 内容摄入管线类型（SourceDocument、AlignmentAction 等）
 * - 批次清单和归档结果类型
 *
 * 所有模块均依赖此文件作为类型基础。
 */

/** ── 页面类型 ──────────────────────────────────────────────────────────── */

/**
 * 页面类型常量映射表
 * 定义了知识库中所有支持的页面类型及其显示属性（标签、表情符号、颜色）
 * @constant
 */
export const PAGE_TYPES = {
  /** 知识点类型 - 通用知识页面 */
  wiki:    { label: '知识点', emoji: '📘', color: '#4A90D9' },
  /** 实体类型 - 人、组织、地点等具体实体 */
  entity:  { label: '实体',   emoji: '🏷️', color: '#E74C3C' },
  /** 概念类型 - 抽象概念、理论等 */
  concept: { label: '概念',   emoji: '💡', color: '#9B59B6' },
  /** 事件类型 - 具有时间属性的事件 */
  event:   { label: '事件',   emoji: '⚡', color: '#F39C12' },
  /** 故事类型 - 叙事性内容 */
  story:   { label: '故事',   emoji: '📖', color: '#27AE60' },
  /** 来源类型 - 引用来源、参考文献 */
  source:  { label: '来源',   emoji: '📰', color: '#7F8C8D' },
} as const;

/**
 * 页面类型联合类型
 * 从 PAGE_TYPES 常量中提取所有键名作为类型
 */
export type PageType = keyof typeof PAGE_TYPES;

/**
 * Wiki 页面接口
 * 表示 Obsidian vault 中的一个完整页面
 */
export interface WikiPage {
  /** 页面标题 */
  title: string;
  /** 页面类型（知识点/实体/概念/事件/故事/来源） */
  type: PageType;
  /** 页面标签列表 */
  tags: string[];
  /** 页面别名列表，用于关联查找 */
  aliases: string[];
  /** 页面正文内容（Markdown 格式） */
  content: string;
  /** 文件路径（相对于 vault 根目录） */
  filePath: string;
  /** 页面中包含的 wikilink 目标列表 */
  wikilinks: string[];
}

/**
 * 提取实体接口
 * 表示从源文档中提取的实体信息
 */
export interface ExtractedEntity {
  /** 实体名称 */
  name: string;
  /** 实体别名列表 */
  aliases: string[];
  /** 实体类型 */
  type: PageType;
  /** 实体描述 */
  description: string;
  /** 相关标签列表 */
  tags: string[];
  /** 实体间的关系列表 */
  relations: { target: string; relation: string }[];
  /** 关键引语列表 */
  keyQuotes: string[];
}

/**
 * 提取事件接口
 * 表示从源文档中提取的事件信息
 */
export interface ExtractedEvent {
  /** 事件名称 */
  name: string;
  /** 事件描述 */
  description: string;
  /** 事件时间 */
  time: string;
  /** 事件地点 */
  location: string;
  /** 事件参与者列表 */
  participants: string[];
  /** 相关标签列表 */
  tags: string[];
  /** 关联的 wiki 页面标题列表 */
  relatedWikis: string[];
}

/**
 * 提取故事接口
 * 表示从源文档中提取的叙事性内容
 */
export interface ExtractedStory {
  /** 故事标题 */
  title: string;
  /** 故事正文内容 */
  content: string;
  /** 来源 URL */
  sourceUrl: string;
  /** 来源标题 */
  sourceTitle: string;
  /** 相关事件列表 */
  events: string[];
  /** 关联的 wiki 页面标题列表 */
  relatedWikis: string[];
  /** 相关标签列表 */
  tags: string[];
}

/**
 * 文档关联结果接口
 * 表示源笔记与 wiki 页面之间的关联分析结果
 */
export interface ConnectionResult {
  /** 源笔记标题 */
  sourceNote: string;
  /** 目标 wiki 页面标题 */
  targetWiki: string;
  /** 关联度评分（0-1 之间） */
  relevance: number;
  /** LLM 生成的关联推理说明 */
  reasoning: string;
  /** 关联类型：直接关联、间接关联、意外关联 */
  connectionType: 'direct' | 'indirect' | 'surprising';
}

/**
 * 图谱节点接口
 * 表示知识图谱中的一个节点（页面）
 */
export interface GraphNode {
  /** 节点唯一标识（通常为页面标题） */
  id: string;
  /** 页面标题 */
  title: string;
  /** 页面类型 */
  type: PageType;
  /** 文件路径（相对于 vault 根目录） */
  filePath: string;
  /** 与该节点直接相连的其他节点 ID 列表 */
  connections: string[];
  /** 是否存在于 vault 中（false 表示建议新建的页面） */
  inVault: boolean;
  /** 页面标签列表 */
  tags: string[];
}

/**
 * 图谱边接口
 * 表示知识图谱中两个节点之间的连接关系
 */
export interface GraphEdge {
  /** 源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 边权重（连接强度） */
  weight: number;
  /** 边类型：wikilink（页面链接）、tag（标签共享）、semantic（语义关联） */
  type: 'wikilink' | 'tag' | 'semantic';
}

/**
 * 知识图谱接口
 * 包含所有节点和边的完整图谱数据结构
 */
export interface Graph {
  /** 节点映射表（key 为节点 ID，value 为节点对象） */
  nodes: Map<string, GraphNode>;
  /** 所有边的列表 */
  edges: GraphEdge[];
}

/** ── 管线类型 ────────────────────────────────────────────────────── */

/**
 * 源文档接口
 * 表示摄入管线的输入文档
 */
export interface SourceDocument {
  /** 文档正文内容 */
  text: string;
  /** 文档标题 */
  title: string;
  /** 文档来源 URL（可选） */
  url?: string;
  /** 捕获时间（ISO 格式日期字符串） */
  captured_at: string;
  /** 来源类型：文件、URL、标准输入 */
  source_type: 'file' | 'url' | 'stdin';
}

/**
 * Vault 索引条目接口
 * 表示 vault 中一个页面的索引信息，用于快速查找和去重
 */
export interface VaultIndexEntry {
  /** 页面标题 */
  title: string;
  /** 页面别名列表 */
  aliases: string[];
  /** 页面标签列表 */
  tags: string[];
  /** 页面类型 */
  type: PageType;
  /** 文件路径（相对于 vault 根目录） */
  path: string;
}

/**
 * Vault 索引类型
 * 由所有 VaultIndexEntry 组成的数组
 */
export type VaultIndex = VaultIndexEntry[];

/**
 * 对齐操作接口
 * 描述提取结果与 vault 现有内容的对齐决策
 */
export interface AlignmentAction {
  /** 被操作的条目名称 */
  item_name: string;
  /** 操作类型：创建新页面、合并到已有页面、重命名 */
  action: 'create' | 'merge' | 'rename';
  /** 合并/重命名的目标路径（可选） */
  target_existing?: string;
  /** 最终使用的名称 */
  resolved_name: string;
  /** 操作原因说明 */
  reason: string;
}

/**
 * 对齐冲突接口
 * 描述提取结果与现有内容之间的命名冲突
 */
export interface AlignmentConflict {
  /** 新条目名称 */
  new_name: string;
  /** 候选匹配列表（包含标题、路径和相似度评分） */
  candidates: { title: string; path: string; score: number }[];
  /** 冲突原因说明 */
  reason: string;
}

/**
 * 对齐提取结果接口
 * Stage 2 对齐阶段的输出，包含实体、事件、操作和冲突
 */
export interface AlignedExtraction {
  /** 对齐后的实体列表 */
  items: ExtractedEntity[];
  /** 对齐后的事件列表 */
  events: ExtractedEvent[];
  /** 对齐操作列表 */
  actions: AlignmentAction[];
  /** 对齐冲突列表 */
  conflicts: AlignmentConflict[];
}

/**
 * 批次清单接口
 * 记录一次摄入批次的元信息和状态
 */
export interface BatchManifest {
  /** 批次唯一标识 */
  batch_id: string;
  /** 源文档信息 */
  source: SourceDocument;
  /** 创建时间（ISO 格式） */
  created_at: string;
  /** 各类型条目数量统计 */
  items_count: { entities: number; events: number; stories: number; concepts: number };
  /** 对齐操作列表 */
  alignment_actions: AlignmentAction[];
  /** 批次状态：待处理、学习中、已归档 */
  status: 'pending' | 'learning' | 'archived';
}

/**
 * Inbox 批次接口
 * 表示 Inbox 中的一个完整批次，包含生成的页面和清单
 */
export interface InboxBatch {
  /** 批次唯一标识 */
  batch_id: string;
  /** 批次基础目录路径（如 00-Inbox/wiki-engine/{batch_id}/） */
  base_dir: string;
  /** 批次包含的所有页面及其文件路径 */
  pages: { page: { frontmatter: Record<string, any>; content: string }; path: string }[];
  /** 批次清单 */
  manifest: BatchManifest;
}

/**
 * 归档结果接口
 * 记录 Inbox→Permanent 归档操作的结果
 */
export interface ArchiveResult {
  /** 归档的批次 ID */
  batch_id: string;
  /** 成功归档的文件列表 */
  archived: { file: string; target: string; action: string }[];
  /** 跳过的文件列表（含原因） */
  skipped: { file: string; reason: string }[];
  /** 警告信息列表 */
  warnings: string[];
  /** MOC（Map of Content）更新记录 */
  moc_updates: { moc: string; action: string; detail?: string }[];
  /** 日志文件路径（可选） */
  daily_log?: string;
}
