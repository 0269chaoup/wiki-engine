import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { buildGraph, findOrphans, findBridges, findComponents } from "../lib/graph.js";

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

      console.log("\n📊 Scanning vault...");
      const pages = await vault.scan();
      console.log(`   Found ${pages.length} pages\n`);

      const graph = buildGraph(pages);
      const edgeCount = graph.edges.length;

      if (opts.stats !== false) {
        console.log("═══ Graph Statistics ═══");
        row("Pages", graph.nodes.size, "36");
        row("Edges", edgeCount, "33");
        const components = findComponents(graph);
        row("Components", components.length, "33");
        row("Avg degree", (edgeCount * 2 / graph.nodes.size).toFixed(1), "33");
        console.log();
      }

      // Top connected pages
      const topN = parseInt(opts.top);
      const sorted = [...graph.nodes.values()].sort((a, b) => b.connections.length - a.connections.length);
      console.log(`═══ Top ${topN} Most Connected ═══`);
      for (const node of sorted.slice(0, topN)) {
        const typeEmoji = { wiki: "📘", entity: "🏷️", concept: "💡", event: "⚡", story: "📖", source: "📰" }[node.type] ?? "📄";
        row(`${typeEmoji} ${node.title}`, `${node.connections.length} connections`, "36");
      }
      console.log();

      // Orphans
      if (opts.orphans) {
        const orphans = findOrphans(graph);
        console.log(`═══ Orphan Pages (${orphans.length}) ═══`);
        for (const o of orphans.slice(0, 30)) {
          row("", o, "90");
        }
        console.log();
      }

      // Bridges
      if (opts.bridges) {
        const bridges = findBridges(graph);
        console.log(`═══ Bridge Pages (${bridges.length}) ═══`);
        for (const b of bridges.slice(0, 20)) {
          row(b.page, `bridges ${b.bridges} clusters`, "33");
        }
        console.log();
      }

      // Components
      if (opts.components) {
        const components = findComponents(graph);
        console.log(`═══ Connected Components (${components.length}) ═══`);
        const sorted = components.sort((a, b) => b.length - a.length);
        for (let i = 0; i < Math.min(sorted.length, 20); i++) {
          row(`Component ${i + 1}`, `${sorted[i].length} pages`, "33");
          if (verbose) {
            for (const p of sorted[i].slice(0, 5)) {
              row("", `  └─ ${p}`, "90");
            }
          }
        }
        console.log();
      }

      // Export
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
