/** ── Page Types ──────────────────────────────────────────────────────────── */

export const PAGE_TYPES = {
  wiki:    { label: '知识点', emoji: '📘', color: '#4A90D9' },
  entity:  { label: '实体',   emoji: '🏷️', color: '#E74C3C' },
  concept: { label: '概念',   emoji: '💡', color: '#9B59B6' },
  event:   { label: '事件',   emoji: '⚡', color: '#F39C12' },
  story:   { label: '故事',   emoji: '📖', color: '#27AE60' },
  source:  { label: '来源',   emoji: '📰', color: '#7F8C8D' },
} as const;

export type PageType = keyof typeof PAGE_TYPES;

export interface WikiPage {
  title: string;
  type: PageType;
  tags: string[];
  aliases: string[];
  content: string;
  filePath: string;   // relative to vault root
  wikilinks: string[];
}

export interface ExtractedEntity {
  name: string;
  aliases: string[];
  type: PageType;
  description: string;
  tags: string[];
  relations: { target: string; relation: string }[];
  keyQuotes: string[];
}

export interface ExtractedEvent {
  name: string;
  description: string;
  time: string;
  location: string;
  participants: string[];
  tags: string[];
  relatedWikis: string[];
}

export interface ExtractedStory {
  title: string;
  content: string;
  sourceUrl: string;
  sourceTitle: string;
  events: string[];
  relatedWikis: string[];
  tags: string[];
}

export interface ConnectionResult {
  sourceNote: string;
  targetWiki: string;
  relevance: number;       // 0-1
  reasoning: string;       // LLM explanation
  connectionType: 'direct' | 'indirect' | 'surprising';
}

export interface GraphNode {
  id: string;
  title: string;
  type: PageType;
  filePath: string;
  connections: string[];
  inVault: boolean;        // false = suggested new page
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: 'wikilink' | 'tag' | 'semantic';
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/** ── Pipeline Types ────────────────────────────────────────────────────── */

export interface SourceDocument {
  text: string;
  title: string;
  url?: string;
  captured_at: string;       // ISO date
  source_type: 'file' | 'url' | 'stdin';
}

export interface VaultIndexEntry {
  title: string;
  aliases: string[];
  tags: string[];
  type: PageType;
  path: string;              // relative to vault root
}

export type VaultIndex = VaultIndexEntry[];

export interface AlignmentAction {
  item_name: string;
  action: 'create' | 'merge' | 'rename';
  target_existing?: string;  // merge/rename target path
  resolved_name: string;     // final name used
  reason: string;
}

export interface AlignmentConflict {
  new_name: string;
  candidates: { title: string; path: string; score: number }[];
  reason: string;
}

export interface AlignedExtraction {
  items: ExtractedEntity[];
  events: ExtractedEvent[];
  actions: AlignmentAction[];
  conflicts: AlignmentConflict[];
}

export interface BatchManifest {
  batch_id: string;
  source: SourceDocument;
  created_at: string;
  items_count: { entities: number; events: number; stories: number; concepts: number };
  alignment_actions: AlignmentAction[];
  status: 'pending' | 'learning' | 'archived';
}

export interface InboxBatch {
  batch_id: string;
  base_dir: string;          // 00-Inbox/wiki-engine/{batch_id}/
  pages: { page: { frontmatter: Record<string, any>; content: string }; path: string }[];
  manifest: BatchManifest;
}

export interface ArchiveResult {
  batch_id: string;
  archived: { file: string; target: string; action: string }[];
  skipped: { file: string; reason: string }[];
  warnings: string[];
  moc_updates: { moc: string; action: string; detail?: string }[];
  daily_log?: string;
}
