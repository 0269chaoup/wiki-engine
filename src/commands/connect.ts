/**
 * @file connect.ts
 * @description 文档关联查找命令
 * 基于知识图谱的本地分析和 LLM 深度分析，为指定笔记查找潜在关联页面。
 * 分两步：先通过本地图算法找候选，再用 LLM 做语义深度分析。
 */
import { Command } from "commander";
import { buildContext, requireLLM, row } from "../lib/cli-utils.js";
import { buildGraph, findPotentialConnections } from "../lib/graph.js";
import type { ConnectionResult } from "../lib/types.js";
import { parseJSON } from "../llm/provider.js";

/**
 * @description LLM 分析连接的提示词模板
 * 将源笔记标题、内容（截取前 3000 字符）和候选页面列表传入，
 * 让 LLM 对每个候选页面评估相关性（0-1）、推理连接原因、并标注连接类型。
 * 只返回相关性 > 0.3 的结果，以 JSON 数组格式输出。
 * @param {string} sourceNote - 源笔记标题
 * @param {string} sourceContent - 源笔记内容
 * @param {string[]} candidates - 候选连接页面标题列表
 * @returns {string} 格式化后的 LLM 提示词
 */
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

/**
 * @description 创建 connect 子命令，查找笔记与现有 wiki 页面之间的关联
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function connectCommand(): Command {
  return new Command("connect")
    .description("Find connections between a note and existing wiki pages")
    .argument("<title>", "note title or file path to analyze")
    .option("--top <n>", "max results", "10")
    .option("--local-only", "use only local graph analysis (no LLM)")
    .option("--json", "output as JSON")
    .action(async (title: string, opts, cmd) => {
      // 构建 CLI 上下文
      const ctx = buildContext(cmd.parent.opts());

      console.log(`\n🔍 Finding connections for: ${title}`);

      // 在 vault 中查找源笔记，支持按标题、文件路径或文件名匹配
      const pages = await ctx.vault.scan();
      const source = pages.find(p =>
        p.title === title || p.filePath === title || p.filePath.endsWith(title)
      );
      if (!source) {
        console.error(`❌ Note not found: ${title}`);
        process.exit(1);
      }
      console.log(`   Source: ${source.filePath} (${source.type})\n`);

      // 构建知识图谱数据结构
      const graph = buildGraph(pages);

      // ─── 第一步：本地图分析（无需 LLM，始终执行）───
      // 通过图的拓扑结构（链接、标签等）查找潜在关联
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

      // ─── 第二步：LLM 深度分析（除非指定了 --local-only）───
      if (opts.localOnly) {
        console.log("   (--local-only: skipping LLM analysis)");
        return;
      }

      // 获取 LLM 提供者实例
      const llm = requireLLM(ctx);
      if (llm.isInteractive()) {
        // 交互模式：提示用户在 Helios 中完成分析
        console.log("🤖 Agent mode — sending analysis prompt to Helios...");
        console.log("   (Helios will analyze connections in chat)\n");
      } else {
        console.log("🤖 Calling LLM for deep connection analysis...\n");
      }

      // 将本地分析结果作为候选传入 LLM
      const candidateTitles = localResults.map(r => r.title);
      const prompt = ANALYZE_CONNECTION_PROMPT(source.title, source.content, candidateTitles);

      try {
        // 调用 LLM 完成语义分析
        const response = await llm.complete(prompt, "You are a knowledge connection analyzer. Always respond in valid JSON.");
        // 解析 LLM 返回的 JSON 结果
        const connections = parseJSON<ConnectionResult[]>(response.content);

        // JSON 输出模式
        if (opts.json) {
          console.log(JSON.stringify(connections, null, 2));
          return;
        }

        // 格式化输出深度连接分析结果
        console.log("═══ Deep Connections ═══");
        // 按相关性从高到低排序
        const sorted = connections.sort((a, b) => b.relevance - a.relevance);
        for (const c of sorted) {
          // 根据连接类型选择 emoji 图标
          const typeEmoji = { direct: "🔗", indirect: "🔄", surprising: "✨" }[c.connectionType] ?? "🔗";
          // 生成可视化相关性进度条
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
