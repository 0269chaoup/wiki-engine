import { Command } from "commander";
import fs from "fs";
import path from "path";
import { buildContext, row } from "../lib/cli-utils.js";
import { archiveBatch } from "../lib/archive.js";
import { readManifest, findBatches } from "../lib/manifest.js";

export function archiveCommand(): Command {
  const cmd = new Command("archive")
    .description("Archive a batch from Inbox to Permanent")
    .option("--batch <id>", "batch ID to archive (e.g. ingest-20260601-pca)")
    .option("--list", "list all pending batches")
    .option("--strategy <mode>", "conflict strategy: merge | overwrite | rename | skip", "merge")
    .option("--no-dedup", "skip LLM dedup, simple append on merge")
    .option("--dry-run", "preview archive operations without writing")
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());
      const vaultRoot = ctx.vault.root;
      const inboxDir = path.join(vaultRoot, "00-Inbox", "wiki-engine");

      // ─── List mode ───
      if (opts.list) {
        return listBatches(inboxDir, vaultRoot);
      }

      // ─── Archive mode ───
      if (!opts.batch) {
        console.error("❌ Please provide --batch <id> or use --list to see available batches");
        process.exit(1);
      }

      const batchId = opts.batch;

      // Validate strategy
      const validStrategies = ["merge", "overwrite", "rename", "skip"];
      if (!validStrategies.includes(opts.strategy)) {
        console.error(`❌ Invalid strategy: ${opts.strategy}. Use: ${validStrategies.join(", ")}`);
        process.exit(1);
      }

      try {
        console.log(`\n🗃️  Archiving: ${batchId}`);
        console.log(`   Strategy: ${opts.strategy}`);
        if (opts.noDedup) console.log("   Dedup: disabled");
        console.log();

        const result = await archiveBatch({
          batchId,
          vaultRoot,
          strategy: opts.strategy,
          dryRun: opts.dryRun,
          noDedup: opts.noDedup,
          verbose: true,
        });

        // Report results
        if (opts.dryRun) {
          console.log("   (dry-run preview)\n");
        }

        if (result.archived.length > 0) {
          console.log(`\n   ✅ Archived (${result.archived.length}):`);
          for (const a of result.archived) {
            row(a.file, `→ ${a.target} [${a.action}]`, "32");
          }
        }

        if (result.skipped.length > 0) {
          console.log(`\n   ⏭️  Skipped (${result.skipped.length}):`);
          for (const s of result.skipped) {
            row(s.file, s.reason, "33");
          }
        }

        if (result.warnings.length > 0) {
          console.log(`\n   ⚠️  Warnings:`);
          for (const w of result.warnings) {
            console.log(`      ${w}`);
          }
        }

        if (result.moc_updates.length > 0) {
          console.log(`\n   📋 MOC updates:`);
          for (const m of result.moc_updates) {
            row(m.moc, `${m.action}${m.detail ? `: ${m.detail}` : ""}`, "36");
          }
        }

        if (result.daily_log) {
          console.log(`\n   📝 Daily log: ${result.daily_log}`);
        }

        if (opts.dryRun) {
          console.log(`\n   Run without --dry-run to execute.`);
        } else {
          console.log(`\n✅ Archive complete: ${batchId}`);
          if (result.skipped.length > 0) {
            console.log(`   ⚠️  ${result.skipped.length} files skipped (Inbox not fully cleaned)`);
          }
        }
      } catch (err) {
        console.error(`\n❌ Archive failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}

function listBatches(inboxDir: string, vaultRoot: string) {
  const batches = findBatches(inboxDir);

  if (batches.length === 0) {
    console.log("\n📭 No batches in Inbox.\n");
    console.log("   Run `wiki-engine ingest <file>` to create a batch.\n");
    return;
  }

  console.log(`\n📥 Inbox batches (${batches.length}):\n`);

  for (const batchDir of batches) {
    const manifest = readManifest(batchDir);
    const batchName = path.basename(batchDir);

    if (manifest) {
      const counts = manifest.items_count;
      const total = counts.entities + counts.events + counts.stories + counts.concepts;
      const statusEmoji = manifest.status === "pending" ? "📥" : manifest.status === "archived" ? "🗃️" : "📖";

      console.log(`   ${statusEmoji} ${batchName}`);
      row("     Status", manifest.status, manifest.status === "pending" ? "33" : "32");
      row("     Items", total, "36");
      row("     Created", manifest.created_at, "33");
      if (manifest.source.url) {
        row("     Source", manifest.source.url, "36");
      }
    } else {
      console.log(`   ❓ ${batchName} (no manifest)`);
    }
    console.log();
  }

  console.log("   Run `wiki-engine archive --batch <id>` to archive a batch.\n");
}
