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
  type: PageType;
  description: string;
  tags: string[];
  relations: { target: string; relation: string }[];
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
