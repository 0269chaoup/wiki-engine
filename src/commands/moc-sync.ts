/**
 * @file moc-sync.ts
 * @description MOC（Map of Content）索引同步命令
 * 将知识文件同步到对应的 MOC 索引文件中，支持单文件同步和批量同步。
 * MOC 是 Obsidian 中的内容地图，用于组织和导航同主题的文档集合。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { syncFileToMoc, syncAllToMocs } from "../lib/moc-sync.js";

/**
 * @description 创建 moc-sync 子命令，将知识文件同步到对应 MOC 索引
 * @returns {Command} 配置好的 Commander 命令实例
 */
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
        // ─── 单文件同步模式 ───
        console.log(`\n🔗 Syncing ${file} → MOC...`);
        const result = await syncFileToMoc(vault.root, file);

        // 状态映射：不同操作结果对应的 emoji 和文本
        const statusMap = {
          added: "✅ Added",
          already_linked: "⏭️ Already linked",
          no_moc: "⚠️ No MOC found",
          error: "❌ Error",
        };
        console.log(`  ${statusMap[result.action]} → ${result.moc}`);
        if (result.detail) console.log(`  ${result.detail}`);
      } else {
        // ─── 批量同步模式 ───
        console.log("\n🔗 Syncing all knowledge files to MOCs...");
        // 如果指定了目录则限定范围
        const dirs = opts.dir ? [opts.dir] : undefined;
        const results = await syncAllToMocs(vault.root, { dryRun: opts.dryRun, dirs });

        // 统计各操作类型的数量
        const added = results.filter(r => r.action === "added").length;
        const linked = results.filter(r => r.action === "already_linked").length;
        const noMoc = results.filter(r => r.action === "no_moc").length;
        const errors = results.filter(r => r.action === "error").length;

        if (opts.dryRun) {
          console.log(`\n📋 Dry run results:`);
        }

        // 显示新增同步的文件
        if (added > 0) {
          console.log(`\n✅ Added (${added}):`);
          for (const r of results.filter(r => r.action === "added")) {
            console.log(`  ${r.file} → ${r.moc}`);
          }
        }

        // 显示未找到对应 MOC 的文件
        if (noMoc > 0) {
          console.log(`\n⚠️ No MOC found (${noMoc}):`);
          for (const r of results.filter(r => r.action === "no_moc")) {
            console.log(`  ${r.file} → ${r.moc}`);
          }
        }

        // 显示错误信息
        if (errors > 0) {
          console.log(`\n❌ Errors (${errors}):`);
          for (const r of results.filter(r => r.action === "error")) {
            console.log(`  ${r.file}: ${r.detail}`);
          }
        }

        // 输出汇总统计表
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
