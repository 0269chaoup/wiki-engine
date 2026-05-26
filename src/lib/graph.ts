import type { WikiPage, Graph, GraphNode, GraphEdge } from "./types.js";

/**
 * Build a knowledge graph from vault pages.
 * Pure local computation — no LLM needed.
 */
export function buildGraph(pages: WikiPage[]): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const titleMap = new Map<string, string>(); // lowercase → canonical title

  // Build title map
  for (const p of pages) {
    titleMap.set(p.title.toLowerCase(), p.title);
    for (const a of p.aliases) titleMap.set(a.toLowerCase(), p.title);
  }

  // Create nodes
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

  // Create edges from wikilinks
  for (const p of pages) {
    for (const link of p.wikilinks) {
      const target = titleMap.get(link.toLowerCase()) ?? link;
      if (target === p.title) continue;

      edges.push({ source: p.title, target, weight: 1, type: "wikilink" });

      // Update connection lists
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

  // Create edges from shared tags
  const tagIndex = new Map<string, string[]>();
  for (const p of pages) {
    for (const t of p.tags) {
      const key = t.toLowerCase();
      if (!tagIndex.has(key)) tagIndex.set(key, []);
      tagIndex.get(key)!.push(p.title);
    }
  }
  for (const [, titles] of tagIndex) {
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        edges.push({ source: titles[i], target: titles[j], weight: 0.5, type: "tag" });
      }
    }
  }

  return { nodes, edges };
}

/** Get degree (connection count) for each node */
export function getDegrees(graph: Graph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const [id, node] of graph.nodes) {
    deg.set(id, node.connections.length);
  }
  return deg;
}

/** Find connected components */
export function findComponents(graph: Graph): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of graph.nodes.keys()) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const stack = [id];
    while (stack.length) {
      const curr = stack.pop()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      component.push(curr);
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

/** Find "bridge" nodes — pages that connect different clusters */
export function findBridges(graph: Graph): { page: string; bridges: number }[] {
  const components = findComponents(graph);
  // A bridge is a node whose removal increases component count
  // Simplified: nodes with connections to multiple components
  const nodeComponent = new Map<string, number>();
  components.forEach((comp, idx) => comp.forEach(id => nodeComponent.set(id, idx)));

  const bridges: { page: string; bridges: number }[] = [];
  for (const [id, node] of graph.nodes) {
    const neighborComponents = new Set(node.connections.map(c => nodeComponent.get(c)).filter(x => x !== undefined));
    const ownComp = nodeComponent.get(id);
    const externalComps = [...neighborComponents].filter(c => c !== ownComp);
    if (externalComps.length > 0) {
      bridges.push({ page: id, bridges: externalComps.length });
    }
  }
  return bridges.sort((a, b) => b.bridges - a.bridges);
}

/** Find orphan pages — no connections at all */
export function findOrphans(graph: Graph): string[] {
  return [...graph.nodes.entries()]
    .filter(([_, n]) => n.connections.length === 0)
    .map(([id]) => id);
}

/** Find potential connections based on shared tags and link proximity */
export function findPotentialConnections(
  graph: Graph,
  targetTitle: string,
  maxResults = 10,
): { title: string; reason: string; score: number }[] {
  const target = graph.nodes.get(targetTitle);
  if (!target) return [];

  const scores = new Map<string, { score: number; reasons: string[] }>();
  const connected = new Set(target.connections);
  connected.add(targetTitle);

  for (const [id, node] of graph.nodes) {
    if (connected.has(id)) continue;
    let score = 0;
    const reasons: string[] = [];

    // Shared tags
    const sharedTags = target.tags.filter(t => node.tags.includes(t));
    if (sharedTags.length > 0) {
      score += sharedTags.length * 0.3;
      reasons.push(`shared tags: ${sharedTags.join(", ")}`);
    }

    // Neighbor overlap (friends of friends)
    const targetConns = new Set(target.connections);
    const overlap = node.connections.filter(c => targetConns.has(c));
    if (overlap.length > 0) {
      score += overlap.length * 0.2;
      reasons.push(`${overlap.length} mutual connections`);
    }

    // Type affinity
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

  return [...scores.entries()]
    .map(([title, { score, reasons }]) => ({ title, reason: reasons.join("; "), score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
