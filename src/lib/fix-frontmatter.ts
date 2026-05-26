import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

export interface FixResult {
  file: string;
  fixes: string[];
}

/**
 * Fix frontmatter issues in a single file.
 */
export function fixFrontmatter(
  vaultRoot: string,
  filePath: string
): FixResult {
  const fixes: string[] = [];
  const abs = path.resolve(vaultRoot, filePath);
  if (!fs.existsSync(abs)) return { file: filePath, fixes: [] };

  let raw = fs.readFileSync(abs, "utf-8");
  let data: Record<string, unknown>;

  try {
    ({ data } = matter(raw));
  } catch {
    // Try to fix broken YAML (e.g., source:: double colon)
    raw = raw.replace(/^source::\s*/gm, "source: ");
    raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    try {
      ({ data } = matter(raw));
      fixes.push("fixed broken YAML");
    } catch {
      return { file: filePath, fixes: ["failed to fix YAML"] };
    }
  }

  // Build new frontmatter
  const fmStart = raw.indexOf("---");
  const fmEnd = raw.indexOf("---", 3);
  if (fmStart < 0 || fmEnd < 0) return { file: filePath, fixes: [] };

  const body = raw.slice(fmEnd + 3);
  const changes: Record<string, unknown> = { ...data };

  // Fix type
  if (!changes.type) {
    changes.type = "Concept";
    fixes.push("added type: Concept");
  }
  const typeMap: Record<string, string> = {
    Guide: "Concept", Reference: "Concept", Insight: "Concept", Resource: "Concept",
    wiki: "Concept", MOC: "Concept",
  };
  if (typeMap[String(changes.type)]) {
    const old = changes.type;
    changes.type = typeMap[String(changes.type)];
    fixes.push(`type: ${old} → ${changes.type}`);
  }

  // Fix domain
  if (!changes.domain) {
    changes.domain = "综合";
    fixes.push("added domain: 综合");
  }

  // Fix created
  if (!changes.created) {
    // Try to extract from filename or use file ctime
    const stat = fs.statSync(abs);
    changes.created = stat.birthtime.toISOString().slice(0, 10);
    fixes.push(`added created: ${changes.created}`);
  }

  // Fix status for Concept
  if (String(changes.type) === "Concept" && !changes.status) {
    changes.status = "🌿 Growing";
    fixes.push("added status: 🌿 Growing");
  }

  // Rebuild frontmatter
  const fmLines = ["---"];
  for (const [key, val] of Object.entries(changes)) {
    if (val === undefined || val === null || val === "") continue;
    if (Array.isArray(val)) {
      fmLines.push(`${key}: [${val.join(", ")}]`);
    } else if (typeof val === "string" && (val.includes(":") || val.includes("#") || val.includes('"'))) {
      fmLines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      fmLines.push(`${key}: ${val}`);
    }
  }
  fmLines.push("---");

  const newRaw = fmLines.join("\n") + body;

  if (fixes.length > 0) {
    fs.writeFileSync(abs, newRaw, "utf-8");
  }

  return { file: filePath, fixes };
}

/**
 * Fix frontmatter in all knowledge files.
 */
export async function fixAllFrontmatter(
  vaultRoot: string,
  opts?: { dirs?: string[]; dryRun?: boolean }
): Promise<FixResult[]> {
  const dirs = opts?.dirs ?? ["Stories", "Events", "Entities", "Concepts"];
  const results: FixResult[] = [];

  for (const dir of dirs) {
    const pattern = `50-Knowledge/Permanent/${dir}/**/*.md`;
    const files = await glob(pattern, {
      cwd: vaultRoot,
      ignore: [".obsidian/**", ".git/**"],
    });

    for (const f of files) {
      const result = fixFrontmatter(vaultRoot, f);
      if (result.fixes.length > 0) {
        results.push(result);
      }
    }
  }

  return results;
}
