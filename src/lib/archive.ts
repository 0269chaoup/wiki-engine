import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";
import type { ArchiveResult, BatchManifest } from "./types.js";
import { readManifest, updateManifestStatus } from "./manifest.js";
import { syncFileToMoc } from "./moc-sync.js";

type ConflictStrategy = "merge" | "overwrite" | "rename" | "skip";

export interface ArchiveOptions {
  batchId: string;
  vaultRoot: string;
  strategy?: ConflictStrategy;
  dryRun?: boolean;
  noDedup?: boolean;
  verbose?: boolean;
}

/**
 * Archive a batch from Inbox to Permanent.
 *
 * Flow:
 * 1. Read _manifest.yaml, validate status == pending
 * 2. Scan batch directory for .md files
 * 3. For each file: check conflict → apply strategy → update frontmatter → write to Permanent
 * 4. Update MOCs (via moc-sync)
 * 5. Log to daily note
 * 6. Delete Inbox batch directory
 */
export async function archiveBatch(opts: ArchiveOptions): Promise<ArchiveResult> {
  const { batchId, vaultRoot, dryRun, noDedup, verbose } = opts;
  const strategy: ConflictStrategy = opts.strategy ?? "merge";

  const result: ArchiveResult = {
    batch_id: batchId,
    archived: [],
    skipped: [],
    warnings: [],
    moc_updates: [],
  };

  // 1. Find and validate batch
  const batchDir = path.join(vaultRoot, "00-Inbox", "wiki-engine", batchId);
  if (!fs.existsSync(batchDir)) {
    throw new Error(`Batch not found: ${batchDir}`);
  }

  const manifest = readManifest(batchDir);
  if (!manifest) {
    throw new Error(`No _manifest.yaml found in ${batchDir}`);
  }
  if (manifest.status === "archived") {
    throw new Error(`Batch ${batchId} is already archived`);
  }

  // 2. Scan all .md files in batch
  const files = await glob("**/*.md", {
    cwd: batchDir,
    ignore: ["_manifest.yaml"],
    absolute: false,
  });

  if (files.length === 0) {
    throw new Error(`No .md files found in ${batchDir}`);
  }

  if (verbose) {
    console.log(`   Found ${files.length} files to archive`);
  }

  // 3. Process each file
  for (const relFile of files) {
    const srcPath = path.join(batchDir, relFile);
    const content = fs.readFileSync(srcPath, "utf-8");
    const { data: fm, content: body } = matter(content);

    // Determine target directory based on file's subdirectory
    const typeDirMap: Record<string, string> = {
      concepts: "Concepts",
      entities: "Entities",
      events: "Events",
      stories: "Stories",
    };

    const parts = relFile.split(path.sep);
    const subDir = parts.length > 1 ? parts[0] : inferTypeDir(fm.type);
    const permanentDir = typeDirMap[subDir] ?? "Concepts";
    const targetDir = path.join(vaultRoot, "50-Knowledge", "Permanent", permanentDir);
    const filename = path.basename(relFile);
    const targetPath = path.join(targetDir, filename);

    // Check conflict
    const conflict = fs.existsSync(targetPath);

    if (dryRun) {
      if (conflict) {
        result.warnings.push(`⚠️  CONFLICT: ${permanentDir}/${filename} exists (strategy: ${strategy})`);
      } else {
        result.archived.push({ file: relFile, target: `${permanentDir}/${filename}`, action: "create" });
      }
      continue;
    }

    if (conflict) {
      switch (strategy) {
        case "skip":
          result.skipped.push({ file: relFile, reason: `conflict: ${filename} exists` });
          continue;

        case "overwrite":
          // Fall through to write
          break;

        case "rename": {
          const date = new Date().toISOString().split("T")[0];
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          const newFilename = `${base}-${date}${ext}`;
          const newPath = path.join(targetDir, newFilename);
          const mergedContent = buildArchivedContent(body, fm, batchId, noDedup);
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(newPath, mergedContent, "utf-8");
          result.archived.push({ file: relFile, target: `${permanentDir}/${newFilename}`, action: "rename" });
          // Sync to MOC
          const mocResult = await syncFileToMoc(vaultRoot, path.relative(vaultRoot, newPath));
          result.moc_updates.push({ moc: mocResult.moc, action: mocResult.action, detail: mocResult.detail });
          continue;
        }

        case "merge": {
          // Merge: append new content to existing file
          const existingRaw = fs.readFileSync(targetPath, "utf-8");
          const { content: existingBody } = matter(existingRaw);

          let mergedBody: string;
          if (noDedup) {
            // Simple append
            mergedBody = existingBody.trimEnd() + "\n\n---\n\n" +
              `## 🔄 补充收录 (${new Date().toISOString().split("T")[0]})\n` +
              `> 来源: ${batchId}\n\n` +
              body.trim();
          } else {
            // LLM dedup: compare and decide append vs merge summary
            mergedBody = await mergeWithDedup(existingBody, body, batchId);
          }

          // Update frontmatter
          const existingFm = matter(existingRaw).data;
          const updatedFm = {
            ...existingFm,
            status: "🗃️ 已归档",
            archived: new Date().toISOString().split("T")[0],
          };
          const mergedContent = buildFrontmatter(updatedFm) + "\n\n" + mergedBody;
          fs.writeFileSync(targetPath, mergedContent, "utf-8");
          result.archived.push({ file: relFile, target: `${permanentDir}/${filename}`, action: "merge" });
          continue;
        }
      }
    }

    // No conflict or overwrite strategy: write directly
    const archivedContent = buildArchivedContent(body, fm, batchId, noDedup);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, archivedContent, "utf-8");
    result.archived.push({
      file: relFile,
      target: `${permanentDir}/${filename}`,
      action: conflict ? "overwrite" : "create",
    });

    // Sync to MOC
    const mocResult = await syncFileToMoc(vaultRoot, path.relative(vaultRoot, targetPath));
    result.moc_updates.push({ moc: mocResult.moc, action: mocResult.action, detail: mocResult.detail });
  }

  // 5. Log to daily note (unless dry-run)
  if (!dryRun && result.archived.length > 0) {
    const logEntry = buildDailyLogEntry(batchId, result);
    appendDailyLog(vaultRoot, logEntry);
    result.daily_log = logEntry;
  }

  // 6. Update manifest status + clean up Inbox (unless dry-run)
  if (!dryRun) {
    updateManifestStatus(batchDir, "archived");
    // Remove batch directory (only if all files archived, none skipped)
    if (result.skipped.length === 0) {
      fs.rmSync(batchDir, { recursive: true, force: true });
    }
  }

  return result;
}

/**
 * Build the final content for an archived file.
 * Updates frontmatter: status → 🗃️ 已归档, adds archived date, source batch.
 */
function buildArchivedContent(
  body: string,
  originalFm: Record<string, any>,
  batchId: string,
  _noDedup?: boolean,
): string {
  const today = new Date().toISOString().split("T")[0];
  const fm = {
    ...originalFm,
    status: "🗃️ 已归档",
    archived: today,
    source: originalFm.source ?? batchId,
  };

  return buildFrontmatter(fm) + "\n\n" + body.trim();
}

/**
 * Merge new content into existing file with LLM dedup.
 * If LLM is not available, falls back to simple append.
 */
async function mergeWithDedup(existingBody: string, newBody: string, batchId: string): Promise<string> {
  // For now, use simple append with section header.
  // LLM dedup will be added when integrated with the agent pipeline.
  // The agent (Helios) can be called to do the merge via the --finalize flow.
  const today = new Date().toISOString().split("T")[0];
  return existingBody.trimEnd() + "\n\n---\n\n" +
    `## 🔄 补充收录 (${today})\n` +
    `> 来源: ${batchId}\n\n` +
    newBody.trim();
}

function inferTypeDir(type?: string): string {
  const map: Record<string, string> = {
    Concept: "concepts",
    Entity: "entities",
    Event: "events",
    Story: "stories",
  };
  return map[type ?? "Concept"] ?? "concepts";
}

function buildFrontmatter(data: Record<string, any>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`);
        }
      }
    } else if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /[:#{}[\],&*?|>!%@`]/.test(v)) {
        lines.push(`${k}: '${v}'`);
      } else {
        lines.push(`${k}: "${v}"`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function buildDailyLogEntry(batchId: string, result: ArchiveResult): string {
  const count = result.archived.length;
  const types = result.archived.reduce((acc, a) => {
    const dir = a.target.split("/")[0];
    acc[dir] = (acc[dir] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const typeSummary = Object.entries(types)
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");

  return `- \`[Agent:Helios]\` 归档 [[${batchId}]] → Permanent (${typeSummary}) #agent-change`;
}

/**
 * Append a log entry to today's daily note under ## 日志.
 * Creates the section if it doesn't exist.
 */
function appendDailyLog(vaultRoot: string, entry: string): void {
  // Find today's daily note
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  // Try common daily note paths
  const candidates = [
    path.join(vaultRoot, "20-Daily", String(year), month, `${dateStr}.md`),
    path.join(vaultRoot, "20-Daily", `${dateStr}.md`),
  ];

  // Also search for daily notes in week-based directories
  const weekPattern = path.join(vaultRoot, "20-Daily", String(year), month, `第*周`, `${dateStr}*.md`);
  const weekMatches = glob.sync(weekPattern);
  candidates.push(...weekMatches);

  let dailyPath = candidates.find(p => fs.existsSync(p));

  if (!dailyPath) {
    // Create a minimal daily note
    dailyPath = candidates[0];
    const dir = path.dirname(dailyPath);
    fs.mkdirSync(dir, { recursive: true });
    const template = [
      "---",
      `date: '${dateStr}'`,
      "---",
      "",
      `# ${dateStr}`,
      "",
      "## 日志",
      "",
      entry,
      "",
    ].join("\n");
    fs.writeFileSync(dailyPath, template, "utf-8");
    return;
  }

  // Append to existing daily note
  const content = fs.readFileSync(dailyPath, "utf-8");

  if (content.includes("## 日志")) {
    // Append after ## 日志 header
    const updated = content.replace(
      /(## 日志\n)/,
      `$1${entry}\n`,
    );
    fs.writeFileSync(dailyPath, updated, "utf-8");
  } else {
    // Add ## 日志 section at end
    const updated = content.trimEnd() + "\n\n## 日志\n\n" + entry + "\n";
    fs.writeFileSync(dailyPath, updated, "utf-8");
  }
}
