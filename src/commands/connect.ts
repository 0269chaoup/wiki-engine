import { Command } from "commander";
import { buildContext, requireLLM, row } from "../lib/cli-utils.js";
import { buildGraph, findPotentialConnections } from "../lib/graph.js";
import type { ConnectionResult } from "../lib/types.js";
import { parseJSON } from "../llm/provider.js";

const ANALYZE_CONNECTION_PROMPT = (sourceNote: string, sourceContent: string, candidates: string[]) =>
`You are a knowledge connection analyzer.

Source note: "${sourceNote}"
Content:
---
${sourceContent.slice(0, 3000)}
---

Candidate pages that might connect to this note:
${candidates.map((c, i) => `${i + 1}. ${c}`).join("\n")}

For EACH candidate, determine if there is a meaningful connection.
Return JSON array:
[
  {
    "target": "candidate page title",
    "relevance": 0.0-1.0,
    "reasoning": "explain the connection in 1-2 sentences",
    "connectionType": "direct" | "indirect" | "surprising"
  }
]

Only include candidates with relevance > 0.3.
Respond ONLY with the JSON array.`;

export function connectCommand(): Command {
  return new Command("connect")
    .description("Find connections between a note and existing wiki pages")
    .argument("<title>", "note title or file path to analyze")
    .option("--top <n>", "max results", "10")
    .option("--local-only", "use only local graph analysis (no LLM)")
    .option("--json", "output as JSON")
    .action(async (title: string, opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      console.log(`\n🔍 Finding connections for: ${title}`);

      // Find the source note
      const pages = await ctx.vault.scan();
      const source = pages.find(p =>
        p.title === title || p.filePath === title || p.filePath.endsWith(title)
      );
      if (!source) {
        console.error(`❌ Note not found: ${title}`);
        process.exit(1);
      }
      console.log(`   Source: ${source.filePath} (${source.type})\n`);

      // Build graph
      const graph = buildGraph(pages);

      // Step 1: Local graph analysis (always runs, no LLM needed)
      console.log("📊 Local graph analysis...");
      const localResults = findPotentialConnections(graph, source.title, parseInt(opts.top));
      if (localResults.length === 0) {
        console.log("   No potential connections found locally.\n");
        if (opts.localOnly) return;
      } else {
        console.log(`   Found ${localResults.length} potential connections:\n`);
        for (const r of localResults) {
          row(r.title, `${r.reason} (score: ${r.score.toFixed(2)})`, "36");
        }
        console.log();
      }

      // Step 2: LLM analysis (unless --local-only)
      if (opts.localOnly) {
        console.log("   (--local-only: skipping LLM analysis)");
        return;
      }

      const llm = requireLLM(ctx);
      if (llm.isInteractive()) {
        console.log("🤖 Agent mode — sending analysis prompt to Helios...");
        console.log("   (Helios will analyze connections in chat)\n");
      } else {
        console.log("🤖 Calling LLM for deep connection analysis...\n");
      }

      const candidateTitles = localResults.map(r => r.title);
      const prompt = ANALYZE_CONNECTION_PROMPT(source.title, source.content, candidateTitles);

      try {
        const response = await llm.complete(prompt, "You are a knowledge connection analyzer. Always respond in valid JSON.");
        const connections = parseJSON<ConnectionResult[]>(response.content);

        if (opts.json) {
          console.log(JSON.stringify(connections, null, 2));
          return;
        }

        console.log("═══ Deep Connections ═══");
        const sorted = connections.sort((a, b) => b.relevance - a.relevance);
        for (const c of sorted) {
          const typeEmoji = { direct: "🔗", indirect: "🔄", surprising: "✨" }[c.connectionType] ?? "🔗";
          const bar = "█".repeat(Math.round(c.relevance * 20)) + "░".repeat(20 - Math.round(c.relevance * 20));
          row(`${typeEmoji} ${c.targetWiki}`, `[${bar}] ${(c.relevance * 100).toFixed(0)}%`, "36");
          console.log(`     ${c.reasoning}`);
        }
        console.log();
      } catch (e) {
        console.error(`❌ LLM analysis failed: ${(e as Error).message}`);
      }
    });
}
