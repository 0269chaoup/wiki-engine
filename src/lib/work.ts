import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

// ── Constants ───────────────────────────────────────────────────────────────

const WORK_DIR = "30-Projects/Work";

// Only Task + TechNote are valid Work types.
// Other types are Knowledge types and should NOT appear in Work files.
const VALID_WORK_TYPES = ["Task", "TechNote"];

// Mapping for auto-normalization: old/inherited type → canonical Work type
const TYPE_NORMALIZE_MAP: Record<string, string> = {
  // Knowledge types → Task (they are work items, not reference material)
  WorkNote: "Task",
  ChangeNote: "TechNote",
  MeetingNote: "TechNote",
  DebugNote: "TechNote",
  Guide: "TechNote",
  Note: "Task",
  GuideNote: "TechNote",
  Proposal: "TechNote",
  TroubleshootingNote: "TechNote",
  Insight: "TechNote",
  Reference: "TechNote",
  Skill: "TechNote",
  // Knowledge ontology types → Task (shouldn't be here at all)
  Concept: "Task",
  Story: "Task",
  Event: "Task",
  Entity: "Task",
};

// Fields that belong to Knowledge, NOT Work — should be stripped during normalization
const KNOWLEDGE_ONLY_FIELDS = [
  "source",
  "related",
  "aliases",
  "keywords",
  "summary",
  "domain",
  "tags",
];

const VALID_WORK_STATUS = [
  "🌱 Planned",
  "🌿 Active",
  "🚧 Blocked",
  "🍂 Completed",
  "🗃️ Archived",
];

// Status order for sorting
const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface WorkFile {
  relativePath: string;
  project: string;
  title: string;
  type: string;
  status: string;
  created: string;
  blocked_by?: string;
}

export interface WorkValidationIssue {
  file: string;
  severity: "error" | "warning";
  field: string;
  detail: string;
}

export interface WorkValidationResult {
  totalFiles: number;
  clean: number;
  warnings: number;
  errors: number;
  issues: WorkValidationIssue[];
}

export interface ProjectSummary {
  name: string;
  fileCount: number;
  statusBreakdown: Record<string, number>;
  blockedItems: { file: string; blocked_by: string }[];
  files: WorkFile[];
}

export interface WorkReport {
  totalFiles: number;
  totalProjects: number;
  projects: ProjectSummary[];
  orphanFiles: WorkFile[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseWorkFile(
  vaultRoot: string,
  relativePath: string
): WorkFile | null {
  const abs = path.resolve(vaultRoot, relativePath);
  if (!fs.existsSync(abs)) return null;

  let raw = fs.readFileSync(abs, "utf-8");
  let data: Record<string, unknown>;

  try {
    ({ data } = matter(raw));
  } catch {
    // Try to fix broken YAML before giving up
    // 1. Fix source:: / related:: double colon
    raw = raw.replace(/^source::\s*/gm, "source: ");
    raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    // 2. Fix Windows paths: escape backslashes in double-quoted strings
    raw = raw.replace(/: "([^"]*\\[^"]*)"/g, (_match: string, inner: string) => {
      return `: "${inner.replace(/\\/g, "\\\\")}"`;
    });
    // 3. Fix duplicated mapping keys (second occurrence → rename)
    const seenKeys = new Set<string>();
    raw = raw.replace(/^(\w[\w-]*):/gm, (match: string, key: string) => {
      if (seenKeys.has(key)) return `_${key}:`;
      seenKeys.add(key);
      return match;
    });
    try {
      ({ data } = matter(raw));
    } catch {
      return null;
    }
  }

  const relFromWork = relativePath.replace(`${WORK_DIR}/`, "");
  const parts = relFromWork.split("/");
  const project = parts.length > 1 ? parts[0] : "General";
  const title =
    (data.title as string) ??
    (data.name as string) ??
    path.basename(relativePath, ".md");

  return {
    relativePath,
    project,
    title,
    type: (data.type as string) ?? "",
    status: (data.status as string) ?? "",
    created: (data.created as string) ?? "",
    blocked_by: (data.blocked_by as string) ?? undefined,
  };
}

async function scanWorkFiles(vaultRoot: string): Promise<WorkFile[]> {
  const exclude = [".obsidian", ".git", ".trash", "node_modules"];
  const pattern = `${WORK_DIR}/**/*.md`;
  const files = await glob(pattern, {
    cwd: vaultRoot,
    ignore: exclude.map((d) => `**/${d}/**`),
    absolute: false,
  });

  return files
    .map((f) => parseWorkFile(vaultRoot, f))
    .filter(Boolean) as WorkFile[];
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateWorkOptions {
  project: string;
  title: string;
  type?: string;
  status?: string;
}

export function createWorkFile(
  vaultRoot: string,
  opts: CreateWorkOptions
): { filePath: string; created: boolean } {
  const type = opts.type ?? "Task";
  const status = opts.status ?? "🌱 Planned";
  const created = today();

  const projectDir =
    opts.project === "General"
      ? path.resolve(vaultRoot, WORK_DIR)
      : path.resolve(vaultRoot, WORK_DIR, opts.project);

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const safeName = opts.title.replace(/[<>:"/\\|?*]/g, "_");
  const filePath = path.join(projectDir, `${safeName}.md`);

  if (fs.existsSync(filePath)) {
    return { filePath: path.relative(vaultRoot, filePath), created: false };
  }

  const fm = [
    "---",
    `title: "${opts.title}"`,
    `type: ${type}`,
    `project: ${opts.project}`,
    `status: ${status}`,
    `created: ${created}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(filePath, fm, "utf-8");
  return { filePath: path.relative(vaultRoot, filePath), created: true };
}

// ── Validate ────────────────────────────────────────────────────────────────

export async function validateWork(
  vaultRoot: string,
  opts?: { project?: string }
): Promise<WorkValidationResult> {
  let files = await scanWorkFiles(vaultRoot);

  if (opts?.project) {
    files = files.filter((f) => f.project === opts.project);
  }

  const issues: WorkValidationIssue[] = [];

  for (const f of files) {
    // Type check — must exist and be canonical (Task or TechNote)
    if (!f.type) {
      issues.push({
        file: f.relativePath,
        severity: "error",
        field: "type",
        detail: "Missing type field",
      });
    } else if (!VALID_WORK_TYPES.includes(f.type)) {
      const suggestion = TYPE_NORMALIZE_MAP[f.type] ?? "Task";
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "type",
        detail: `Non-canonical type "${f.type}" → should be "${suggestion}"`,
      });
    }

    // Status check
    if (!f.status) {
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "status",
        detail: "Missing status field",
      });
    }

    // Created check
    if (!f.created) {
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "created",
        detail: "Missing created date",
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;

  return {
    totalFiles: files.length,
    clean: files.length - new Set(issues.map((i) => i.file)).size,
    warnings: warnCount,
    errors: errorCount,
    issues,
  };
}

// ── Index ───────────────────────────────────────────────────────────────────

export async function generateIndex(
  vaultRoot: string,
  opts?: { project?: string }
): Promise<{ project: string; filePath: string; fileCount: number }[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: { project: string; filePath: string; fileCount: number }[] =
    [];

  const byProject = new Map<string, WorkFile[]>();
  for (const f of files) {
    if (opts?.project && f.project !== opts.project) continue;
    const existing = byProject.get(f.project) ?? [];
    existing.push(f);
    byProject.set(f.project, existing);
  }

  for (const [project, projectFiles] of byProject) {
    const indexDir =
      project === "General"
        ? path.resolve(vaultRoot, WORK_DIR)
        : path.resolve(vaultRoot, WORK_DIR, project);

    if (!fs.existsSync(indexDir)) {
      fs.mkdirSync(indexDir, { recursive: true });
    }

    const indexPath = path.join(indexDir, "INDEX.md");

    // Group files by status
    const byStatus = new Map<string, WorkFile[]>();
    for (const f of projectFiles) {
      const st = f.status || "未标注";
      const existing = byStatus.get(st) ?? [];
      existing.push(f);
      byStatus.set(st, existing);
    }

    // Build INDEX content
    const lines: string[] = [
      "---",
      `title: "${project} 项目索引"`,
      `type: TechNote`,
      `project: ${project}`,
      `status: 🍂 Completed`,
      `created: ${today()}`,
      `updated: ${today()}`,
      "---",
      "",
      `# ${project}`,
      "",
      `> 📊 **${projectFiles.length}** 个文档`,
      "",
    ];

    const sortedStatuses = [...byStatus.entries()].sort(
      (a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])
    );

    for (const [status, statusFiles] of sortedStatuses) {
      lines.push(`## ${status} (${statusFiles.length})`);
      lines.push("");
      for (const f of statusFiles.sort(
        (a, b) => String(b.created || "").localeCompare(String(a.created || ""))
      )) {
        const name = path.basename(f.relativePath, ".md");
        const blocked =
          status === "🚧 Blocked" && f.blocked_by
            ? ` ⛔ ${f.blocked_by}`
            : "";
        lines.push(`- [[${name}]]${blocked}`);
      }
      lines.push("");
    }

    fs.writeFileSync(indexPath, lines.join("\n"), "utf-8");
    results.push({
      project,
      filePath: path.relative(vaultRoot, indexPath),
      fileCount: projectFiles.length,
    });
  }

  return results;
}

// ── Archive with Compaction ─────────────────────────────────────────────────

export async function archiveProject(
  vaultRoot: string,
  projectName: string,
  opts?: { compact?: boolean }
): Promise<{
  archived: number;
  skipped: number;
  compacted: number;
  postMortemPath?: string;
}> {
  const files = await scanWorkFiles(vaultRoot);
  const projectFiles = files.filter((f) => f.project === projectName);

  let archived = 0;
  let skipped = 0;
  let compacted = 0;

  // Collect TechNotes for compaction
  const techNotes: { title: string; content: string }[] = [];

  for (const f of projectFiles) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) {
      skipped++;
      continue;
    }

    const raw = fs.readFileSync(abs, "utf-8");
    let data: Record<string, unknown>;
    let content: string;

    try {
      const parsed = matter(raw);
      data = parsed.data;
      content = parsed.content;
    } catch {
      skipped++;
      continue;
    }

    if (data.status === "🗃️ Archived") {
      skipped++;
      continue;
    }

    // Compaction: collect TechNotes before archiving
    if (opts?.compact && f.type === "TechNote") {
      techNotes.push({ title: f.title, content });
      compacted++;
    }

    data.status = "🗃️ Archived";
    const newRaw = matter.stringify(content, data);
    fs.writeFileSync(abs, newRaw, "utf-8");
    archived++;
  }

  // Generate post-mortem if compacting
  let postMortemPath: string | undefined;
  if (opts?.compact && techNotes.length > 0) {
    const projectDir =
      projectName === "General"
        ? path.resolve(vaultRoot, WORK_DIR)
        : path.resolve(vaultRoot, WORK_DIR, projectName);

    postMortemPath = path.join(projectDir, `POSTMORTEM-${today()}.md`);

    const lines = [
      "---",
      `title: "${projectName} 项目复盘"`,
      `type: TechNote`,
      `project: ${projectName}`,
      `status: 🍂 Completed`,
      `created: ${today()}`,
      "---",
      "",
      `# ${projectName} 项目复盘`,
      "",
      `> 自动生成于 ${today()}，包含 ${techNotes.length} 个技术笔记的压实内容`,
      "",
      "---",
      "",
    ];

    for (const note of techNotes) {
      lines.push(`## ${note.title}`);
      lines.push("");
      lines.push(note.content.trim());
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    fs.writeFileSync(postMortemPath, lines.join("\n"), "utf-8");
  }

  return {
    archived,
    skipped,
    compacted,
    postMortemPath: postMortemPath
      ? path.relative(vaultRoot, postMortemPath)
      : undefined,
  };
}

// ── Task ────────────────────────────────────────────────────────────────────

export interface TaskGroup {
  name: string;
  categories: {
    name: string;
    tasks: { text: string; done: boolean }[];
  }[];
}

export function buildTaskCallout(groups: TaskGroup[]): string {
  const lines: string[] = [];

  for (const group of groups) {
    lines.push(`> [!todo] ${group.name}`);
    for (const cat of group.categories) {
      lines.push(`> - **${cat.name}**`);
      for (const task of cat.tasks) {
        const check = task.done ? "[x]" : "[ ]";
        lines.push(`>   - ${check} ${task.text}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function createTaskNote(
  vaultRoot: string,
  opts: {
    project: string;
    title: string;
    groups: TaskGroup[];
  }
): { filePath: string; created: boolean } {
  const projectDir =
    opts.project === "General"
      ? path.resolve(vaultRoot, WORK_DIR)
      : path.resolve(vaultRoot, WORK_DIR, opts.project);

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const safeName = opts.title.replace(/[<>:"/\\|?*]/g, "_");
  const filePath = path.join(projectDir, `${safeName}.md`);

  if (fs.existsSync(filePath)) {
    return { filePath: path.relative(vaultRoot, filePath), created: false };
  }

  const taskContent = buildTaskCallout(opts.groups);

  const fm = [
    "---",
    `title: "${opts.title}"`,
    `type: Task`,
    `project: ${opts.project}`,
    `status: 🌱 Planned`,
    `created: ${today()}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    taskContent,
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(filePath, fm, "utf-8");
  return { filePath: path.relative(vaultRoot, filePath), created: true };
}

// ── Fix Frontmatter ─────────────────────────────────────────────────────────

export async function fixWorkFrontmatter(
  vaultRoot: string,
  opts?: { project?: string; dryRun?: boolean }
): Promise<{ file: string; fixes: string[] }[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: { file: string; fixes: string[] }[] = [];

  const targetFiles = opts?.project
    ? files.filter((f) => f.project === opts.project)
    : files;

  for (const f of targetFiles) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

    let raw = fs.readFileSync(abs, "utf-8");
    let data: Record<string, unknown>;
    const fixes: string[] = [];

    const hasFrontmatter = raw.startsWith("---");

    if (hasFrontmatter) {
      try {
        ({ data } = matter(raw));
      } catch {
        raw = raw.replace(/^source::\s*/gm, "source: ");
        raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
        try {
          ({ data } = matter(raw));
          fixes.push("fixed broken YAML");
        } catch {
          results.push({ file: f.relativePath, fixes: ["failed to fix YAML"] });
          continue;
        }
      }
    } else {
      data = {};
    }

    const changes: Record<string, unknown> = { ...data };

    // Fix type
    if (!changes.type) {
      changes.type = "Task";
      fixes.push("added type: Task");
    }

    // Fix project
    if (!changes.project) {
      changes.project = f.project;
      fixes.push(`added project: ${f.project}`);
    }

    // Fix status — migrate old values
    const statusMap: Record<string, string> = {
      "🌱 Seed": "🌱 Planned",
      "🌿 Growing": "🌿 Active",
      "🌲 Evergreen": "🍂 Completed",
    };
    if (!changes.status) {
      changes.status = "🌱 Planned";
      fixes.push("added status: 🌱 Planned");
    } else if (statusMap[String(changes.status)]) {
      const old = changes.status;
      changes.status = statusMap[String(changes.status)];
      fixes.push(`status: ${old} → ${changes.status}`);
    }

    // Fix created
    if (!changes.created) {
      const stat = fs.statSync(abs);
      changes.created = stat.birthtime.toISOString().slice(0, 10);
      fixes.push(`added created: ${changes.created}`);
    }

    // Remove old domain/tags if present (migration from old format)
    if (changes.domain) {
      delete changes.domain;
      fixes.push("removed domain (Work不需要)");
    }
    if (changes.tags) {
      delete changes.tags;
      fixes.push("removed tags (Work不需要)");
    }

    if (fixes.length === 0) continue;

    if (!opts?.dryRun) {
      const fmLines = ["---"];
      for (const [key, val] of Object.entries(changes)) {
        if (val === undefined || val === null || val === "") continue;
        if (Array.isArray(val)) {
          fmLines.push(`${key}: [${val.join(", ")}]`);
        } else if (
          typeof val === "string" &&
          (val.includes(":") || val.includes("#") || val.includes('"'))
        ) {
          fmLines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
        } else {
          fmLines.push(`${key}: ${val}`);
        }
      }
      fmLines.push("---");

      if (hasFrontmatter) {
        const fmStart = raw.indexOf("---");
        const fmEnd = raw.indexOf("---", 3);
        const body = raw.slice(fmEnd + 3);
        const newRaw = fmLines.join("\n") + body;
        fs.writeFileSync(abs, newRaw, "utf-8");
      } else {
        const newRaw = fmLines.join("\n") + "\n\n" + raw;
        fs.writeFileSync(abs, newRaw, "utf-8");
      }
    }

    results.push({ file: f.relativePath, fixes });
  }

  return results;
}

// ── Normalize ──────────────────────────────────────────────────────────────

export interface NormalizeResult {
  file: string;
  changes: string[];
  moved?: string; // new relative path if file was relocated
}

export async function normalizeWorkFiles(
  vaultRoot: string,
  opts?: { project?: string; dryRun?: boolean }
): Promise<NormalizeResult[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: NormalizeResult[] = [];

  const targetFiles = opts?.project
    ? files.filter((f) => f.project === opts.project)
    : files;

  for (const f of targetFiles) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

    let raw = fs.readFileSync(abs, "utf-8");
    const changes: string[] = [];

    // 1. Parse frontmatter (with broken-YAML recovery)
    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch {
      // Attempt same fix as fixWorkFrontmatter
      raw = raw.replace(/^source::\s*/gm, "source: ");
      raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
      try {
        ({ data } = matter(raw));
        changes.push("fixed broken YAML");
      } catch {
        continue; // skip unparseable
      }
    }

    // 2. Normalize type → Task or TechNote
    if (data.type && !VALID_WORK_TYPES.includes(String(data.type))) {
      const mapped = TYPE_NORMALIZE_MAP[String(data.type)] ?? "Task";
      changes.push(`type: ${data.type} → ${mapped}`);
      data.type = mapped;
    }

    // 3. Strip Knowledge-only fields
    for (const field of KNOWLEDGE_ONLY_FIELDS) {
      if (data[field] !== undefined) {
        delete data[field];
        changes.push(`removed ${field}`);
      }
    }

    // 4. Normalize `date:` → `created:` (keep the value)
    if (data.date && !data.created) {
      const dateVal = String(data.date);
      // Try to parse into YYYY-MM-DD
      const parsed = new Date(dateVal);
      if (!isNaN(parsed.getTime())) {
        data.created = parsed.toISOString().slice(0, 10);
      } else {
        data.created = dateVal;
      }
      delete data.date;
      changes.push(`date → created: ${data.created}`);
    } else if (data.date && data.created) {
      // Both exist — remove `date`
      delete data.date;
      changes.push("removed redundant date (kept created)");
    }

    // 5. Format created as YYYY-MM-DD if it's a long date string
    if (data.created && typeof data.created === "string") {
      const c = data.created;
      if (c.includes("GMT") || c.includes("T")) {
        const parsed = new Date(c);
        if (!isNaN(parsed.getTime())) {
          const normalized = parsed.toISOString().slice(0, 10);
          if (normalized !== c) {
            changes.push(`created: "${c}" → ${normalized}`);
            data.created = normalized;
          }
        }
      }
    }

    // 6. Ensure project field matches directory
    if (!data.project) {
      data.project = f.project;
      changes.push(`added project: ${f.project}`);
    } else if (data.project !== f.project) {
      // Directory says one thing, frontmatter says another
      // Keep frontmatter value but warn
      changes.push(`project mismatch: dir=${f.project}, fm=${data.project}`);
    }

    if (changes.length === 0) continue;

    // 7. Write back
    if (!opts?.dryRun) {
      const content = matter.stringify(raw, data);
      fs.writeFileSync(abs, content, "utf-8");
    }

    results.push({ file: f.relativePath, changes });
  }

  // 8. Move orphan files (root-level, project=General) into project dirs
  // Only if they clearly belong to a project based on filename
  const orphans = targetFiles.filter(
    (f) => f.project === "General" && !f.relativePath.endsWith("INDEX.md")
  );

  for (const f of orphans) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

    // Read frontmatter to check if project field exists
    let raw: string;
    try {
      raw = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch {
      continue;
    }

    // If frontmatter has a specific project, move the file there
    if (data.project && data.project !== "General") {
      const targetDir = path.resolve(vaultRoot, WORK_DIR, String(data.project));
      const targetPath = path.join(targetDir, path.basename(f.relativePath));

      if (!opts?.dryRun) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.renameSync(abs, targetPath);
      }

      const result = results.find((r) => r.file === f.relativePath);
      const moveNote = `moved to ${data.project}/${path.basename(f.relativePath)}`;
      if (result) {
        result.moved = `${data.project}/${path.basename(f.relativePath)}`;
        result.changes.push(moveNote);
      } else {
        results.push({
          file: f.relativePath,
          changes: [moveNote],
          moved: `${data.project}/${path.basename(f.relativePath)}`,
        });
      }
    }
  }

  return results;
}

// ── Report ──────────────────────────────────────────────────────────────────

export async function generateReport(
  vaultRoot: string
): Promise<WorkReport> {
  const files = await scanWorkFiles(vaultRoot);

  const byProject = new Map<string, WorkFile[]>();
  const orphans: WorkFile[] = [];

  for (const f of files) {
    if (f.project === "General") {
      orphans.push(f);
    } else {
      const existing = byProject.get(f.project) ?? [];
      existing.push(f);
      byProject.set(f.project, existing);
    }
  }

  const projects: ProjectSummary[] = [];
  for (const [name, projectFiles] of byProject) {
    const statusBreakdown: Record<string, number> = {};
    const blockedItems: { file: string; blocked_by: string }[] = [];

    for (const f of projectFiles) {
      const st = f.status || "未标注";
      statusBreakdown[st] = (statusBreakdown[st] ?? 0) + 1;

      if (st === "🚧 Blocked" && f.blocked_by) {
        blockedItems.push({ file: f.title, blocked_by: f.blocked_by });
      }
    }

    projects.push({
      name,
      fileCount: projectFiles.length,
      statusBreakdown,
      blockedItems,
      files: projectFiles,
    });
  }

  projects.sort((a, b) => b.fileCount - a.fileCount);

  return {
    totalFiles: files.length,
    totalProjects: byProject.size,
    projects,
    orphanFiles: orphans,
  };
}
