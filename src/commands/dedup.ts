/**
 * @file dedup.ts
 * @description 三阶段去重检测命令
 * 扫描整个 Vault 中的文档，检测重复或高度相似的页面。
 * 通过相似度阈值过滤，将结果分为高置信重复和需要人工审核两类。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { dedupScan } from "../lib/dedup.js";

/**
 * @description 创建 dedup 子命令，扫描 Vault 检测重复/相似页面
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function dedupCommand(): Command {
  return new Command("dedup")
    .description("Scan vault for duplicate/similar pages")
    .option("--threshold <n>", "similarity threshold (0-1)", "0.6")
    .option("--json", "output as JSON")
    .option("--fix", "auto-fix high-confidence duplicates (rename/merge)")
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      // 扫描 vault 中所有页面
      console.log("\n🔎 Scanning vault for duplicates...");
      const pages = await ctx.vault.scan();
      console.log(`   Found ${pages.length} pages\n`);

      // 将每页与其他所有页面进行相似度比较
      const allMatches = dedupScan(pages, pages);

      // 去除重复的匹配对（A↔B 和 B↔A 只保留一次）
      const seen = new Set<string>();
      const unique = allMatches.filter(m => {
        // 用排序后的标题拼接作为去重键，确保 A↔B 和 B↔A 映射到同一个 key
        const key = [m.newTitle, m.existingTitle].sort().join("|||");
        if (seen.has(key)) return false;
        seen.add(key);
        // 排除自身匹配
        return m.newTitle !== m.existingTitle;
      });

      // 按相似度阈值过滤
      const threshold = parseFloat(opts.threshold);
      const filtered = unique.filter(m => m.score >= threshold);

      // JSON 输出模式
      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        console.log("✅ No duplicates found!\n");
        return;
      }

      console.log(`═══ Potential Duplicates (${filtered.length}) ═══\n`);

      // 按操作类型分类：skip = 高置信重复，review = 需人工审核
      const skip = filtered.filter(m => m.action === "skip");
      const review = filtered.filter(m => m.action === "review");

      // 显示高置信度重复（红色标记）
      if (skip.length > 0) {
        console.log(`  ⛔ High-confidence duplicates (${skip.length}):`);
        for (const m of skip) {
          row(m.newTitle, `≈ ${m.existingTitle} (${(m.score * 100).toFixed(0)}%)`, "31");
          console.log(`     Reasons: ${m.reasons.join(", ")}`);
        }
        console.log();
      }

      // 显示需要审核的匹配（黄色标记）
      if (review.length > 0) {
        console.log(`  ⚠️  Needs review (${review.length}):`);
        for (const m of review) {
          row(m.newTitle, `≈ ${m.existingTitle} (${(m.score * 100).toFixed(0)}%)`, "33");
          console.log(`     Reasons: ${m.reasons.join(", ")}`);
        }
        console.log();
      }
    });
}
