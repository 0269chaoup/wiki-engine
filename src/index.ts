#!/usr/bin/env node
import { Command } from "commander";
import { graphCommand } from "./commands/graph.js";
import { connectCommand } from "./commands/connect.js";
import { dedupCommand } from "./commands/dedup.js";
import { ingestCommand } from "./commands/ingest.js";
import { scanCommand } from "./commands/scan.js";
import { mocSyncCommand } from "./commands/moc-sync.js";
import { quoteCommand } from "./commands/quote.js";
import { validateCommand } from "./commands/validate.js";
import { createCommand } from "./commands/create.js";
import { fixFrontmatterCommand } from "./commands/fix-frontmatter.js";
import { archiveCommand } from "./commands/archive.js";

const program = new Command();

program
  .name("wiki-engine")
  .description("Obsidian vault analysis engine — graph, dedup, connections, ingest")
  .version("1.0.0")
  .option("--vault <path>", "vault root directory", process.env.OBSIDIAN_VAULT ?? process.cwd())
  .option("--llm <provider>", "LLM provider: agent | api", "agent")
  .option("--api-provider <name>", "API provider: anthropic | openai", "anthropic")
  .option("--model <name>", "LLM model name", "claude-sonnet-4-6")
  .option("--api-key <key>", "API key (or set ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY)")
  .option("--base-url <url>", "Custom API base URL (for proxies)")
  .option("--verbose", "verbose output", false);

program.addCommand(graphCommand());
program.addCommand(connectCommand());
program.addCommand(dedupCommand());
program.addCommand(ingestCommand());
program.addCommand(scanCommand());
program.addCommand(mocSyncCommand());
program.addCommand(quoteCommand());
program.addCommand(validateCommand());
program.addCommand(createCommand());
program.addCommand(fixFrontmatterCommand());
program.addCommand(archiveCommand());

program.parse();
