/**
 * @file scan.ts
 * @description Vault 扫描统计命令
 * 快速扫描整个 Vault，展示页面总数、类型分布、标签云和链接密度等统计信息。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { PAGE_TYPES } from "../lib/types.js";

/**
 * @description 创建 scan 子命令，快速扫描 Vault 并输出统计报告
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function scanCommand(): Command {
  return new Command("scan")
    .description("Quick vault scan — page count, type distribution, tag cloud")
    .option("--tags", "show tag distribution")
    .option("--recent <n>", "show N most recently modified files", "10")
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      // 扫描 vault 中所有页面
      console.log("\n🔍 Scanning vault...");
      const pages = await ctx.vault.scan();

      // ─── 类型分布统计 ───
      // 统计每种文档类型（entity/concept/event/story 等）的数量
      const typeCount = new Map<string, number>();
      for (const p of pages) {
        typeCount.set(p.type, (typeCount.get(p.type) ?? 0) + 1);
      }

      console.log("\n═══ Page Types ═══");
      // 按数量从高到低排序，显示带进度条的类型分布
      for (const [type, count] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
        const info = PAGE_TYPES[type as keyof typeof PAGE_TYPES];
        const emoji = info?.emoji ?? "📄";
        const label = info?.label ?? type;
        // 生成可视化进度条
        const bar = "█".repeat(Math.round(count / pages.length * 40));
        row(`${emoji} ${label} (${type})`, `${count} ${bar}`, "36");
      }
      console.log();

      // ─── 标签云 ───
      if (opts.tags) {
        // 统计每个标签的使用次数
        const tagCount = new Map<string, number>();
        for (const p of pages) {
          for (const t of p.tags) {
            tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
          }
        }
        // 取使用最多的 30 个标签
        const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
        console.log("═══ Top Tags ═══");
        for (const [tag, count] of sorted) {
          row(`#${tag}`, count, "35");
        }
        console.log();
      }

      // ─── 总体统计 ───
      row("Total pages", pages.length, "36");
      // 计算所有页面中的 wikilink 总数
      const totalLinks = pages.reduce((sum, p) => sum + p.wikilinks.length, 0);
      row("Total wikilinks", totalLinks, "33");
      // 计算平均每页的链接数
      row("Avg links/page", (totalLinks / pages.length).toFixed(1), "33");
      console.log();
    });
}
