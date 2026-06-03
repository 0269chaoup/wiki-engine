/**
 * @file 知识图谱构建与分析模块
 *
 * 提供纯本地计算（无需 LLM）的知识图谱功能：
 * - buildGraph：从 vault 页面构建知识图谱
 * - getDegrees：计算节点度数（连接数）
 * - findComponents：查找连通分量（聚类）
 * - findBridges：查找桥接节点（连接不同聚类的页面）
 * - findOrphans：查找孤立页面（无任何连接）
 * - findPotentialConnections：基于标签共享和连接邻近性发现潜在关联
 *
 * 图谱结构：
 * - 节点：每个页面对应一个节点
 * - 边：wikilink（页面链接，权重 1）和标签共享（权重 0.5）
 */

import type { WikiPage, Graph, GraphNode, GraphEdge } from "./types.js";

/**
 * 从 vault 页面列表构建知识图谱
 *
 * 构建流程：
 * 1. 创建标题映射表（标题/别名 → 规范标题）
 * 2. 为每个页面创建节点
 * 3. 从 wikilink 创建有向边
 * 4. 从共享标签创建无向边
 *
 * 纯本地计算，不需要 LLM。
 *
 * @param pages - vault 中的所有页面
 * @returns 完整的知识图谱对象（包含节点 Map 和边列表）
 */
export function buildGraph(pages: WikiPage[]): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  /** 标题映射表：小写标题 → 规范标题（用于不区分大小写的链接解析） */
  const titleMap = new Map<string, string>();

  /** 第一步：构建标题映射表（包括别名） */
  for (const p of pages) {
    titleMap.set(p.title.toLowerCase(), p.title);
    for (const a of p.aliases) titleMap.set(a.toLowerCase(), p.title);
  }

  /** 第二步：为每个页面创建节点 */
  for (const p of pages) {
    nodes.set(p.title, {
      id: p.title,
      title: p.title,
      type: p.type,
      filePath: p.filePath,
      connections: [],
      inVault: true,
      tags: p.tags,
    });
  }

  /** 第三步：从 wikilink 创建边 */
  for (const p of pages) {
    for (const link of p.wikilinks) {
      /** 通过标题映射表解析链接目标（不区分大小写） */
      const target = titleMap.get(link.toLowerCase()) ?? link;
      /** 跳过自引用链接 */
      if (target === p.title) continue;

      /** 创建 wikilink 类型的边（权重 1） */
      edges.push({ source: p.title, target, weight: 1, type: "wikilink" });

      /** 更新双向连接列表 */
      const sourceNode = nodes.get(p.title);
      const targetNode = nodes.get(target);
      if (sourceNode && !sourceNode.connections.includes(target)) {
        sourceNode.connections.push(target);
      }
      if (targetNode && !targetNode.connections.includes(p.title)) {
        targetNode.connections.push(p.title);
      }
    }
  }

  /** 第四步：从共享标签创建边 */
  /** 构建标签→页面列表的索引 */
  const tagIndex = new Map<string, string[]>();
  for (const p of pages) {
    for (const t of p.tags) {
      const key = t.toLowerCase();
      if (!tagIndex.has(key)) tagIndex.set(key, []);
      tagIndex.get(key)!.push(p.title);
    }
  }
  /** 对共享同一标签的页面两两创建边（权重 0.5） */
  for (const [, titles] of tagIndex) {
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        edges.push({ source: titles[i], target: titles[j], weight: 0.5, type: "tag" });
      }
    }
  }

  return { nodes, edges };
}

/**
 * 获取每个节点的度数（连接数）
 *
 * @param graph - 知识图谱对象
 * @returns 节点 ID → 度数的映射表
 */
export function getDegrees(graph: Graph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const [id, node] of graph.nodes) {
    deg.set(id, node.connections.length);
  }
  return deg;
}

/**
 * 查找图谱中的连通分量（聚类）
 *
 * 使用深度优先搜索（DFS）遍历图谱，将互相连接的节点归为同一分量。
 *
 * @param graph - 知识图谱对象
 * @returns 连通分量数组，每个分量是节点 ID 数组
 */
export function findComponents(graph: Graph): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of graph.nodes.keys()) {
    if (visited.has(id)) continue;
    /** 使用栈实现 DFS */
    const component: string[] = [];
    const stack = [id];
    while (stack.length) {
      const curr = stack.pop()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      component.push(curr);
      /** 将未访问的邻居加入栈 */
      const node = graph.nodes.get(curr);
      if (node) {
        for (const conn of node.connections) {
          if (!visited.has(conn)) stack.push(conn);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * 查找桥接节点 —— 连接不同聚类的页面
 *
 * 桥接节点的邻居分布在多个不同的连通分量中，
 * 移除这些节点会导致聚类分裂。
 *
 * @param graph - 知识图谱对象
 * @returns 桥接节点列表，按桥接数量降序排列
 */
export function findBridges(graph: Graph): { page: string; bridges: number }[] {
  const components = findComponents(graph);
  /** 构建节点→分量索引的映射表 */
  const nodeComponent = new Map<string, number>();
  components.forEach((comp, idx) => comp.forEach(id => nodeComponent.set(id, idx)));

  const bridges: { page: string; bridges: number }[] = [];
  for (const [id, node] of graph.nodes) {
    /** 收集邻居所在的分量 */
    const neighborComponents = new Set(node.connections.map(c => nodeComponent.get(c)).filter(x => x !== undefined));
    const ownComp = nodeComponent.get(id);
    /** 过滤出与自身不同分量的邻居分量 */
    const externalComps = [...neighborComponents].filter(c => c !== ownComp);
    if (externalComps.length > 0) {
      bridges.push({ page: id, bridges: externalComps.length });
    }
  }
  /** 按桥接数量降序排列 */
  return bridges.sort((a, b) => b.bridges - a.bridges);
}

/**
 * 查找孤立页面 —— 没有任何连接的页面
 *
 * @param graph - 知识图谱对象
 * @returns 孤立页面的标题数组
 */
export function findOrphans(graph: Graph): string[] {
  return [...graph.nodes.entries()]
    .filter(([_, n]) => n.connections.length === 0)
    .map(([id]) => id);
}

/**
 * 查找潜在关联 —— 基于标签共享和连接邻近性
 *
 * 评分因素：
 * 1. 共享标签：每个标签 +0.3 分
 * 2. 共同邻居（朋友的朋友）：每个 +0.2 分
 * 3. 类型亲和度：不同类型之间有不同的亲和系数
 *
 * @param graph - 知识图谱对象
 * @param targetTitle - 目标页面标题
 * @param maxResults - 最大返回结果数（默认 10）
 * @returns 潜在关联列表，按评分降序排列
 */
export function findPotentialConnections(
  graph: Graph,
  targetTitle: string,
  maxResults = 10,
): { title: string; reason: string; score: number }[] {
  const target = graph.nodes.get(targetTitle);
  if (!target) return [];

  const scores = new Map<string, { score: number; reasons: string[] }>();
  /** 已连接的节点集合（排除自身和已有连接） */
  const connected = new Set(target.connections);
  connected.add(targetTitle);

  for (const [id, node] of graph.nodes) {
    /** 跳过已连接的节点和自身 */
    if (connected.has(id)) continue;
    let score = 0;
    const reasons: string[] = [];

    /** 因素 1：共享标签 */
    const sharedTags = target.tags.filter(t => node.tags.includes(t));
    if (sharedTags.length > 0) {
      score += sharedTags.length * 0.3;
      reasons.push(`shared tags: ${sharedTags.join(", ")}`);
    }

    /** 因素 2：共同邻居（朋友的朋友） */
    const targetConns = new Set(target.connections);
    const overlap = node.connections.filter(c => targetConns.has(c));
    if (overlap.length > 0) {
      score += overlap.length * 0.2;
      reasons.push(`${overlap.length} mutual connections`);
    }

    /** 因素 3：类型亲和度矩阵 */
    const affinity: Record<string, Record<string, number>> = {
      entity:  { entity: 0.2, concept: 0.3, event: 0.4 },
      concept: { concept: 0.2, entity: 0.3, wiki: 0.3 },
      event:   { entity: 0.4, story: 0.5, concept: 0.2 },
      story:   { event: 0.5, entity: 0.3, concept: 0.2 },
      wiki:    { wiki: 0.2, concept: 0.3 },
      source:  { entity: 0.2, event: 0.2 },
    };
    const typeBonus = affinity[target.type]?.[node.type] ?? 0;
    if (typeBonus > 0) {
      score += typeBonus;
      reasons.push(`type affinity: ${target.type}↔${node.type}`);
    }

    if (score > 0) {
      scores.set(id, { score, reasons });
    }
  }

  /** 按评分降序排列并截取指定数量 */
  return [...scores.entries()]
    .map(([title, { score, reasons }]) => ({ title, reason: reasons.join("; "), score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
