/**
 * @file archive.ts
 * @description Inbox→Permanent 归档命令
 * 提供将 00-Inbox/wiki-engine 目录中的批次（batch）文档归档到永久目录的功能。
 * 支持列出待归档批次、选择冲突策略（merge/overwrite/rename/skip）、
 * 跳过 LLM 去重、以及干运行预览模式。
 */
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { buildContext, row } from "../lib/cli-utils.js";
import { archiveBatch } from "../lib/archive.js";
import { readManifest, findBatches } from "../lib/manifest.js";

/**
 * @description 创建 archive 子命令，用于将 Inbox 中的批次归档到 Permanent 目录
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function archiveCommand(): Command {
  const cmd = new Command("archive")
    .description("Archive a batch from Inbox to Permanent")
    .option("--batch <id>", "batch ID to archive (e.g. ingest-20260601-pca)")
    .option("--list", "list all pending batches")
    .option("--strategy <mode>", "conflict strategy: merge | overwrite | rename | skip", "merge")
    .option("--no-dedup", "skip LLM dedup, simple append on merge")
    .option("--dry-run", "preview archive operations without writing")
    .action(async (opts, cmd) => {
      // 构建 CLI 上下文，获取 vault 根目录等配置
      const ctx = buildContext(cmd.parent.opts());
      const vaultRoot = ctx.vault.root;
      // Inbox 目录路径：00-Inbox/wiki-engine
      const inboxDir = path.join(vaultRoot, "00-Inbox", "wiki-engine");

      // ─── 列表模式：列出所有待归档批次 ───
      if (opts.list) {
        return listBatches(inboxDir, vaultRoot);
      }

      // ─── 归档模式：必须指定 --batch 参数 ───
      if (!opts.batch) {
        console.error("❌ Please provide --batch <id> or use --list to see available batches");
        process.exit(1);
      }

      const batchId = opts.batch;

      // 校验冲突策略是否合法
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

        // 执行归档操作，将 Inbox 批次文档移动到 Permanent 目录
        const result = await archiveBatch({
          batchId,
          vaultRoot,
          strategy: opts.strategy,
          dryRun: opts.dryRun,
          noDedup: opts.noDedup,
          verbose: true,
        });

        // ─── 输出归档结果报告 ───

        // 干运行模式提示
        if (opts.dryRun) {
          console.log("   (dry-run preview)\n");
        }

        // 显示成功归档的文件列表
        if (result.archived.length > 0) {
          console.log(`\n   ✅ Archived (${result.archived.length}):`);
          for (const a of result.archived) {
            row(a.file, `→ ${a.target} [${a.action}]`, "32");
          }
        }

        // 显示跳过的文件列表
        if (result.skipped.length > 0) {
          console.log(`\n   ⏭️  Skipped (${result.skipped.length}):`);
          for (const s of result.skipped) {
            row(s.file, s.reason, "33");
          }
        }

        // 显示警告信息
        if (result.warnings.length > 0) {
          console.log(`\n   ⚠️  Warnings:`);
          for (const w of result.warnings) {
            console.log(`      ${w}`);
          }
        }

        // 显示 MOC 索引更新记录
        if (result.moc_updates.length > 0) {
          console.log(`\n   📋 MOC updates:`);
          for (const m of result.moc_updates) {
            row(m.moc, `${m.action}${m.detail ? `: ${m.detail}` : ""}`, "36");
          }
        }

        // 显示每日日志路径
        if (result.daily_log) {
          console.log(`\n   📝 Daily log: ${result.daily_log}`);
        }

        // 归档完成后的最终提示
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

/**
 * @description 列出 Inbox 目录中所有批次及其状态信息
 * @param {string} inboxDir - Inbox 目录的绝对路径
 * @param {string} vaultRoot - Vault 根目录的绝对路径
 */
function listBatches(inboxDir: string, vaultRoot: string) {
  // 扫描 Inbox 目录，查找所有批次子目录
  const batches = findBatches(inboxDir);

  if (batches.length === 0) {
    console.log("\n📭 No batches in Inbox.\n");
    console.log("   Run `wiki-engine ingest <file>` to create a batch.\n");
    return;
  }

  console.log(`\n📥 Inbox batches (${batches.length}):\n`);

  // 遍历每个批次，读取 manifest 并显示摘要信息
  for (const batchDir of batches) {
    const manifest = readManifest(batchDir);
    const batchName = path.basename(batchDir);

    if (manifest) {
      // 计算批次中的文档总数
      const counts = manifest.items_count;
      const total = counts.entities + counts.events + counts.stories + counts.concepts;
      // 根据状态选择对应的 emoji 图标
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
