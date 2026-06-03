/**
 * @file graph.ts
 * @description 知识图谱构建与分析命令
 * 从 Vault 中扫描所有页面，构建知识图谱数据结构，
 * 并提供统计信息、孤立页面检测、桥接页面分析、连通分量识别等功能。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { buildGraph, findOrphans, findBridges, findComponents } from "../lib/graph.js";

/**
 * @description 创建 graph 子命令，用于构建和分析知识图谱
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function graphCommand(): Command {
  return new Command("graph")
    .description("Build and analyze the knowledge graph from vault")
    .option("--stats", "show graph statistics", true)
    .option("--orphans", "show orphan pages (no connections)")
    .option("--bridges", "show bridge pages (connecting clusters)")
    .option("--components", "show connected components")
    .option("--top <n>", "show top N most connected pages", "20")
    .option("--export <path>", "export graph as JSON")
    .action(async (opts, cmd) => {
      const { vault, verbose } = buildContext(cmd.parent.opts());

      // 扫描 vault 中所有页面
      console.log("\n📊 Scanning vault...");
      const pages = await vault.scan();
      console.log(`   Found ${pages.length} pages\n`);

      // 构建图数据结构（节点 + 边）
      const graph = buildGraph(pages);
      const edgeCount = graph.edges.length;

      // ─── 图统计信息 ───
      if (opts.stats !== false) {
        console.log("═══ Graph Statistics ═══");
        row("Pages", graph.nodes.size, "36");
        row("Edges", edgeCount, "33");
        // 计算连通分量数量
        const components = findComponents(graph);
        row("Components", components.length, "33");
        // 平均度数 = 边数 × 2 / 节点数（每条边贡献两个度）
        row("Avg degree", (edgeCount * 2 / graph.nodes.size).toFixed(1), "33");
        console.log();
      }

      // ─── 连接数最多的 Top N 页面 ───
      const topN = parseInt(opts.top);
      // 按连接数从高到低排序
      const sorted = [...graph.nodes.values()].sort((a, b) => b.connections.length - a.connections.length);
      console.log(`═══ Top ${topN} Most Connected ═══`);
      for (const node of sorted.slice(0, topN)) {
        // 根据节点类型选择 emoji 图标
        const typeEmoji = { wiki: "📘", entity: "🏷️", concept: "💡", event: "⚡", story: "📖", source: "📰" }[node.type] ?? "📄";
        row(`${typeEmoji} ${node.title}`, `${node.connections.length} connections`, "36");
      }
      console.log();

      // ─── 孤立页面（无任何连接的页面）───
      if (opts.orphans) {
        const orphans = findOrphans(graph);
        console.log(`═══ Orphan Pages (${orphans.length}) ═══`);
        for (const o of orphans.slice(0, 30)) {
          row("", o, "90");
        }
        console.log();
      }

      // ─── 桥接页面（连接不同集群的枢纽节点）───
      if (opts.bridges) {
        const bridges = findBridges(graph);
        console.log(`═══ Bridge Pages (${bridges.length}) ═══`);
        for (const b of bridges.slice(0, 20)) {
          row(b.page, `bridges ${b.bridges} clusters`, "33");
        }
        console.log();
      }

      // ─── 连通分量（相互连通的页面子图）───
      if (opts.components) {
        const components = findComponents(graph);
        console.log(`═══ Connected Components (${components.length}) ═══`);
        // 按分量大小从大到小排序
        const sorted = components.sort((a, b) => b.length - a.length);
        for (let i = 0; i < Math.min(sorted.length, 20); i++) {
          row(`Component ${i + 1}`, `${sorted[i].length} pages`, "33");
          // 详细模式下显示每个分量的前 5 个页面
          if (verbose) {
            for (const p of sorted[i].slice(0, 5)) {
              row("", `  └─ ${p}`, "90");
            }
          }
        }
        console.log();
      }

      // ─── 导出图数据为 JSON 文件 ───
      if (opts.export) {
        const fs = await import("fs");
        const data = {
          nodes: [...graph.nodes.values()],
          edges: graph.edges,
          stats: {
            pageCount: graph.nodes.size,
            edgeCount,
            componentCount: findComponents(graph).length,
            orphanCount: findOrphans(graph).length,
          },
        };
        fs.writeFileSync(opts.export, JSON.stringify(data, null, 2));
        console.log(`💾 Graph exported to ${opts.export}`);
      }
    });
}
