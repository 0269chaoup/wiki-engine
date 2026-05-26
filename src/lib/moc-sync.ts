import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

export interface MocSyncResult {
  file: string;
  moc: string;
  action: "added" | "already_linked" | "no_moc" | "error";
  detail?: string;
}

/**
 * Sync a knowledge file's link into its corresponding MOC.
 *
 * Logic:
 * 1. Read file frontmatter → extract type, domain, title
 * 2. Determine target MOC: MOCs/MOC-{domain}.md
 * 3. Check if MOC already contains [[title]]
 * 4. If not, add `- [[title]] — {one-liner}` under the right section
 * 5. Write MOC back
 */
export async function syncFileToMoc(
  vaultRoot: string,
  filePath: string
): Promise<MocSyncResult> {
  const abs = path.resolve(vaultRoot, filePath);
  if (!fs.existsSync(abs)) {
    return { file: filePath, moc: "", action: "error", detail: "File not found" };
  }

    // Parse frontmatter
    const raw = fs.readFileSync(abs, "utf-8");
    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch (e) {
      return { file: filePath, moc: "", action: "error", detail: `YAML parse error: ${(e as Error).message?.slice(0, 80)}` };
    }

  const title = String(data.title ?? path.basename(filePath, ".md"));
  const type = String(data.type ?? "Concept");
  const domain = String(data.domain ?? "综合");
  const oneliner = extractOneliner(raw);

  // Determine MOC path
  const mocFileName = `MOC-${domain}.md`;
  const mocPath = path.join(vaultRoot, "50-Knowledge", "MOCs", mocFileName);

  if (!fs.existsSync(mocPath)) {
    return { file: filePath, moc: mocFileName, action: "no_moc", detail: `MOC not found: ${mocPath}` };
  }

  // Read MOC
  const mocRaw = fs.readFileSync(mocPath, "utf-8");

  // Check if already linked
  const linkPattern = new RegExp(`\\[\\[${escapeRegex(title)}[\\]|]`);
  if (linkPattern.test(mocRaw)) {
    return { file: filePath, moc: mocFileName, action: "already_linked" };
  }

  // Find insertion point — add after the last section header that makes sense
  // Strategy: find the last `## ` section, and append before the next `---` or end
  const typeEmoji: Record<string, string> = {
    Entity: "🏷️",
    Event: "⚡",
    Story: "📖",
    Concept: "💡",
  };
  const emoji = typeEmoji[type] ?? "💡";
  const entry = `- [[${title}]]${oneliner ? ` — ${oneliner}` : ""}`;

  // Insert at end of file (before trailing whitespace)
  const updated = mocRaw.trimEnd() + "\n\n" + entry + "\n";

  fs.writeFileSync(mocPath, updated, "utf-8");

  return { file: filePath, moc: mocFileName, action: "added", detail: entry };
}

/**
 * Batch sync all files in Permanent/ to their MOCs.
 */
export async function syncAllToMocs(
  vaultRoot: string,
  opts?: { dryRun?: boolean; dirs?: string[] }
): Promise<MocSyncResult[]> {
  const dirs = opts?.dirs ?? ["Stories", "Events", "Entities", "Concepts"];
  const results: MocSyncResult[] = [];

  for (const dir of dirs) {
    const pattern = `50-Knowledge/Permanent/${dir}/**/*.md`;
    const files = await glob(pattern, {
      cwd: vaultRoot,
      ignore: [".obsidian/**", ".git/**"],
    });

    for (const f of files) {
      if (opts?.dryRun) {
        // Just check, don't write
        const abs = path.join(vaultRoot, f);
        const raw = fs.readFileSync(abs, "utf-8");
        let data: Record<string, unknown>;
        try {
          ({ data } = matter(raw));
        } catch {
          results.push({ file: f, moc: "", action: "error", detail: "YAML parse error" });
          continue;
        }
        const domain = String(data.domain ?? "综合");
        const mocPath = path.join(vaultRoot, "50-Knowledge", "MOCs", `MOC-${domain}.md`);
        const title = String(data.title ?? path.basename(f, ".md"));

        if (!fs.existsSync(mocPath)) {
          results.push({ file: f, moc: `MOC-${domain}.md`, action: "no_moc" });
          continue;
        }

        const mocRaw = fs.readFileSync(mocPath, "utf-8");
        const linkPattern = new RegExp(`\\[\\[${escapeRegex(title)}[\\]|]`);
        const linked = linkPattern.test(mocRaw);
        results.push({
          file: f,
          moc: `MOC-${domain}.md`,
          action: linked ? "already_linked" : "added",
        });
      } else {
        const result = await syncFileToMoc(vaultRoot, f);
        results.push(result);
      }
    }
  }

  return results;
}

/** Extract One-Liner from 归档信息 block */
function extractOneliner(content: string): string {
  const m = content.match(/\*\*One-Liner\*\*:\s*(.+?)(?:\n|$)/);
  return m?.[1]?.trim() ?? "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
