import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { syncFileToMoc, syncAllToMocs } from "../lib/moc-sync.js";

export function mocSyncCommand(): Command {
  return new Command("moc-sync")
    .description("Sync knowledge files into their corresponding MOC (Map of Content)")
    .argument("[file]", "specific file to sync (relative to vault root). If omitted, syncs all.")
    .option("--dry-run", "check what would be synced without writing", false)
    .option("--dir <name>", "limit to a specific Permanent subdirectory (Stories|Events|Entities|Concepts)")
    .action(async (file: string | undefined, opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());
      const vault = ctx.vault;

      if (file) {
        // Sync single file
        console.log(`\n🔗 Syncing ${file} → MOC...`);
        const result = await syncFileToMoc(vault.root, file);

        const statusMap = {
          added: "✅ Added",
          already_linked: "⏭️ Already linked",
          no_moc: "⚠️ No MOC found",
          error: "❌ Error",
        };
        console.log(`  ${statusMap[result.action]} → ${result.moc}`);
        if (result.detail) console.log(`  ${result.detail}`);
      } else {
        // Batch sync
        console.log("\n🔗 Syncing all knowledge files to MOCs...");
        const dirs = opts.dir ? [opts.dir] : undefined;
        const results = await syncAllToMocs(vault.root, { dryRun: opts.dryRun, dirs });

        // Summary
        const added = results.filter(r => r.action === "added").length;
        const linked = results.filter(r => r.action === "already_linked").length;
        const noMoc = results.filter(r => r.action === "no_moc").length;
        const errors = results.filter(r => r.action === "error").length;

        if (opts.dryRun) {
          console.log(`\n📋 Dry run results:`);
        }

        // Show added files
        if (added > 0) {
          console.log(`\n✅ Added (${added}):`);
          for (const r of results.filter(r => r.action === "added")) {
            console.log(`  ${r.file} → ${r.moc}`);
          }
        }

        if (noMoc > 0) {
          console.log(`\n⚠️ No MOC found (${noMoc}):`);
          for (const r of results.filter(r => r.action === "no_moc")) {
            console.log(`  ${r.file} → ${r.moc}`);
          }
        }

        if (errors > 0) {
          console.log(`\n❌ Errors (${errors}):`);
          for (const r of results.filter(r => r.action === "error")) {
            console.log(`  ${r.file}: ${r.detail}`);
          }
        }

        // Summary table
        console.log();
        row("Total files", results.length, "36");
        row("Added to MOC", added, "32");
        row("Already linked", linked, "33");
        row("No MOC found", noMoc, "31");
        if (errors) row("Errors", errors, "31");
        console.log();
      }
    });
}
