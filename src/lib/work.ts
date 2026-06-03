/**
 * @file 工作任务管理逻辑模块
 *
 * 管理 Obsidian vault 中的工作任务文件（30-Projects/Work/ 目录）。
 * 提供任务文件的创建、验证、索引生成、归档、规范化和报告功能。
 *
 * 核心概念：
 * - Work 类型：仅支持 Task 和 TechNote 两种规范类型
 * - 项目归属：通过目录结构确定（30-Projects/Work/{project}/）
 * - 状态管理：🌱 Planned → 🌿 Active → 🚧 Blocked → 🍂 Completed → 🗃️ Archived
 * - 规范化：自动修正旧类型、清理知识库专属字段、移动孤立文件
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

// ── 常量定义 ───────────────────────────────────────────────────────────────

/** Work 文件的根目录（相对于 vault 根目录） */
const WORK_DIR = "30-Projects/Work";

/**
 * 有效的 Work 文件类型
 * 仅 Task 和 TechNote 两种，其他类型均为知识库类型
 */
const VALID_WORK_TYPES = ["Task", "TechNote"];

/**
 * 类型规范化映射表
 * 将旧类型/继承类型映射到规范的 Work 类型
 * 知识库类型统一映射为 Task
 */
const TYPE_NORMALIZE_MAP: Record<string, string> = {
  /** Work 相关旧类型 */
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
  /** 知识库本体类型（不应出现在 Work 文件中） */
  Concept: "Task",
  Story: "Task",
  Event: "Task",
  Entity: "Task",
};

/**
 * 知识库专属字段列表
 * 这些字段属于知识库文件，在 Work 文件规范化时应被移除
 */
const KNOWLEDGE_ONLY_FIELDS = [
  "source",
  "related",
  "aliases",
  "keywords",
  "summary",
  "domain",
  "tags",
];

/** 有效的 Work 文件状态值 */
const VALID_WORK_STATUS = [
  "🌱 Planned",
  "🌿 Active",
  "🚧 Blocked",
  "🍂 Completed",
  "🗃️ Archived",
];

/**
 * 状态排序优先级
 * 用于索引文件中的状态分组排序
 */
const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

// ── 接口定义 ──────────────────────────────────────────────────────────────

/**
 * Work 文件接口
 * 表示一个解析后的工作任务文件
 */
export interface WorkFile {
  /** 相对于 vault 根目录的文件路径 */
  relativePath: string;
  /** 所属项目名称（从目录结构推断） */
  project: string;
  /** 文件标题 */
  title: string;
  /** 文件类型（Task/TechNote） */
  type: string;
  /** 状态 */
  status: string;
  /** 创建日期 */
  created: string;
  /** 阻塞原因（可选） */
  blocked_by?: string;
}

/**
 * Work 验证问题接口
 */
export interface WorkValidationIssue {
  /** 问题所在的文件路径 */
  file: string;
  /** 严重程度：error（错误）或 warning（警告） */
  severity: "error" | "warning";
  /** 问题涉及的字段 */
  field: string;
  /** 问题详细描述 */
  detail: string;
}

/**
 * Work 验证结果接口
 */
export interface WorkValidationResult {
  /** 扫描的文件总数 */
  totalFiles: number;
  /** 无问题的文件数 */
  clean: number;
  /** 警告数量 */
  warnings: number;
  /** 错误数量 */
  errors: number;
  /** 所有问题列表 */
  issues: WorkValidationIssue[];
}

/**
 * 项目摘要接口
 * 汇总一个项目下所有 Work 文件的状态分布
 */
export interface ProjectSummary {
  /** 项目名称 */
  name: string;
  /** 文件数量 */
  fileCount: number;
  /** 按状态分组的数量统计 */
  statusBreakdown: Record<string, number>;
  /** 被阻塞的任务列表 */
  blockedItems: { file: string; blocked_by: string }[];
  /** 项目下所有文件列表 */
  files: WorkFile[];
}

/**
 * Work 报告接口
 * 包含所有项目的汇总信息
 */
export interface WorkReport {
  /** 文件总数 */
  totalFiles: number;
  /** 项目总数 */
  totalProjects: number;
  /** 各项目摘要列表 */
  projects: ProjectSummary[];
  /** 孤立文件（不属于任何项目的文件） */
  orphanFiles: WorkFile[];
}

// ── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * @description 获取当天日期字符串（YYYY-MM-DD 格式）
 * @returns 日期字符串
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @description 解析单个 Work 文件为 WorkFile 对象
 *
 * 解析流程：
 * 1. 读取文件内容
 * 2. 使用 gray-matter 解析 frontmatter
 * 3. 如果 YAML 解析失败，尝试修复常见问题后重试
 * 4. 从目录结构推断项目名称
 * 5. 提取标题、类型、状态等字段
 *
 * @param vaultRoot - vault 根目录路径
 * @param relativePath - 文件相对于 vault 根目录的路径
 * @returns 解析后的 WorkFile 对象，失败时返回 null
 */
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
    /** YAML 解析失败，尝试修复常见问题 */
    /** 1. 修复 source:: 双冒号语法 */
    raw = raw.replace(/^source::\s*/gm, "source: ");
    /** 2. 移除 related:: 内联元数据 */
    raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    /** 3. 修复 Windows 路径中的反斜杠 */
    raw = raw.replace(/: "([^"]*\\[^"]*)"/g, (_match: string, inner: string) => {
      return `: "${inner.replace(/\\/g, "\\\\")}"`;
    });
    /** 4. 修复重复的 YAML 映射键 */
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

  /** 从目录结构推断项目名称 */
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

/**
 * @description 扫描 Work 目录下的所有 .md 文件并解析
 *
 * @param vaultRoot - vault 根目录路径
 * @returns 解析后的 WorkFile 数组
 */
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

// ── 创建功能 ──────────────────────────────────────────────────────────────────

/**
 * 创建 Work 文件的选项接口
 */
export interface CreateWorkOptions {
  /** 所属项目名称 */
  project: string;
  /** 文件标题 */
  title: string;
  /** 文件类型（默认 "Task"） */
  type?: string;
  /** 初始状态（默认 "🌱 Planned"） */
  status?: string;
}

/**
 * @description 创建新的 Work 文件
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 创建选项
 * @returns 创建结果：文件路径和是否为新创建
 */
export function createWorkFile(
  vaultRoot: string,
  opts: CreateWorkOptions
): { filePath: string; created: boolean } {
  const type = opts.type ?? "Task";
  const status = opts.status ?? "🌱 Planned";
  const created = today();

  /** 确定项目目录 */
  const projectDir =
    opts.project === "General"
      ? path.resolve(vaultRoot, WORK_DIR)
      : path.resolve(vaultRoot, WORK_DIR, opts.project);

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  /** 清理文件名中的非法字符 */
  const safeName = opts.title.replace(/[<>:"/\\|?*]/g, "_");
  const filePath = path.join(projectDir, `${safeName}.md`);

  /** 文件已存在则不覆盖 */
  if (fs.existsSync(filePath)) {
    return { filePath: path.relative(vaultRoot, filePath), created: false };
  }

  /** 构建文件内容 */
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

// ── 验证功能 ────────────────────────────────────────────────────────────────

/**
 * @description 验证所有 Work 文件的 frontmatter 和结构
 *
 * 检查项：
 * - type 字段：必须存在且为规范类型（Task/TechNote）
 * - status 字段：是否存在
 * - created 字段：是否存在
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：project（按项目过滤）
 * @returns 验证结果
 */
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
    /** 类型检查 */
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

    /** 状态检查 */
    if (!f.status) {
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "status",
        detail: "Missing status field",
      });
    }

    /** 创建日期检查 */
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

// ── 索引生成功能 ───────────────────────────────────────────────────────────

/**
 * @description 为每个项目生成 INDEX.md 索引文件
 *
 * 索引文件按状态分组列出所有 Work 文件，
 * 状态按优先级排序：Blocked → Active → Planned → Completed → Archived。
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：project（只生成指定项目的索引）
 * @returns 生成的索引文件列表
 */
export async function generateIndex(
  vaultRoot: string,
  opts?: { project?: string }
): Promise<{ project: string; filePath: string; fileCount: number }[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: { project: string; filePath: string; fileCount: number }[] = [];

  /** 按项目分组 */
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

    /** 按状态分组 */
    const byStatus = new Map<string, WorkFile[]>();
    for (const f of projectFiles) {
      const st = f.status || "未标注";
      const existing = byStatus.get(st) ?? [];
      existing.push(f);
      byStatus.set(st, existing);
    }

    /** 构建索引文件内容 */
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

    /** 按状态优先级排序 */
    const sortedStatuses = [...byStatus.entries()].sort(
      (a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])
    );

    for (const [status, statusFiles] of sortedStatuses) {
      lines.push(`## ${status} (${statusFiles.length})`);
      lines.push("");
      /** 按创建日期降序排列 */
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

// ── 归档与压实功能 ─────────────────────────────────────────────────────────

/**
 * @description 归档整个项目（支持可选的内容压实）
 *
 * 归档流程：
 * 1. 将所有非 Archived 状态的文件标记为 "🗃️ Archived"
 * 2. 如果启用 compact，收集所有 TechNote 内容
 * 3. 生成 POSTMORTEM 复盘文件（包含所有 TechNote 的压实内容）
 *
 * @param vaultRoot - vault 根目录路径
 * @param projectName - 项目名称
 * @param opts - 选项：compact（是否压实 TechNote）
 * @returns 归档统计结果
 */
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

  /** 收集 TechNote 内容用于压实 */
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

    /** 已归档的文件跳过 */
    if (data.status === "🗃️ Archived") {
      skipped++;
      continue;
    }

    /** 压实模式：收集 TechNote 内容 */
    if (opts?.compact && f.type === "TechNote") {
      techNotes.push({ title: f.title, content });
      compacted++;
    }

    /** 更新状态为已归档 */
    data.status = "🗃️ Archived";
    const newRaw = matter.stringify(content, data);
    fs.writeFileSync(abs, newRaw, "utf-8");
    archived++;
  }

  /** 生成复盘文件（如果启用压实且有 TechNote） */
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

// ── 任务清单功能 ────────────────────────────────────────────────────────────

/**
 * 任务分组接口
 * 用于构建 Obsidian 的 task callout 块
 */
export interface TaskGroup {
  /** 分组名称 */
  name: string;
  /** 分类列表 */
  categories: {
    /** 分类名称 */
    name: string;
    /** 任务列表 */
    tasks: { text: string; done: boolean }[];
  }[];
}

/**
 * @description 将任务分组构建为 Obsidian task callout 格式
 *
 * @param groups - 任务分组数组
 * @returns 格式化的 callout Markdown 内容
 */
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

/**
 * @description 创建包含任务清单的 Work 文件
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：project、title、groups
 * @returns 创建结果
 */
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

// ── Frontmatter 修复功能 ─────────────────────────────────────────────────────────

/**
 * @description 修复 Work 文件的 frontmatter 问题
 *
 * 修复项：
 * - 补充缺失的 type、project、status、created 字段
 * - 迁移旧状态值（🌱 Seed → 🌱 Planned 等）
 * - 移除不属于 Work 的字段（domain、tags）
 * - 修复损坏的 YAML 语法
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：project（按项目过滤）、dryRun（模拟运行）
 * @returns 修复结果列表
 */
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
        /** 尝试修复损坏的 YAML */
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

    /** 补充缺失的 type 字段 */
    if (!changes.type) {
      changes.type = "Task";
      fixes.push("added type: Task");
    }

    /** 补充缺失的 project 字段 */
    if (!changes.project) {
      changes.project = f.project;
      fixes.push(`added project: ${f.project}`);
    }

    /** 修复状态值：迁移旧格式 */
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

    /** 补充缺失的 created 字段 */
    if (!changes.created) {
      const stat = fs.statSync(abs);
      changes.created = stat.birthtime.toISOString().slice(0, 10);
      fixes.push(`added created: ${changes.created}`);
    }

    /** 移除不属于 Work 的字段 */
    if (changes.domain) {
      delete changes.domain;
      fixes.push("removed domain (Work不需要)");
    }
    if (changes.tags) {
      delete changes.tags;
      fixes.push("removed tags (Work不需要)");
    }

    if (fixes.length === 0) continue;

    /** 写回修复后的文件 */
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

// ── 规范化功能 ──────────────────────────────────────────────────────────────

/**
 * 规范化结果接口
 */
export interface NormalizeResult {
  /** 文件路径 */
  file: string;
  /** 变更列表 */
  changes: string[];
  /** 如果文件被移动，记录新路径 */
  moved?: string;
}

/**
 * @description 规范化所有 Work 文件
 *
 * 规范化操作：
 * 1. 修复损坏的 YAML 语法
 * 2. 将非规范类型映射为 Task/TechNote
 * 3. 移除知识库专属字段（source、domain、tags 等）
 * 4. 将 date 字段迁移到 created
 * 5. 格式化 created 日期为 YYYY-MM-DD
 * 6. 确保 project 字段与目录结构一致
 * 7. 将孤立文件移动到正确的项目目录
 *
 * @param vaultRoot - vault 根目录路径
 * @param opts - 选项：project（按项目过滤）、dryRun（模拟运行）
 * @returns 规范化结果列表
 */
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

    /** 步骤 1：解析 frontmatter（带损坏修复） */
    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch {
      raw = raw.replace(/^source::\s*/gm, "source: ");
      raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
      try {
        ({ data } = matter(raw));
        changes.push("fixed broken YAML");
      } catch {
        continue; // 跳过无法解析的文件
      }
    }

    /** 步骤 2：规范化类型为 Task 或 TechNote */
    if (data.type && !VALID_WORK_TYPES.includes(String(data.type))) {
      const mapped = TYPE_NORMALIZE_MAP[String(data.type)] ?? "Task";
      changes.push(`type: ${data.type} → ${mapped}`);
      data.type = mapped;
    }

    /** 步骤 3：移除知识库专属字段 */
    for (const field of KNOWLEDGE_ONLY_FIELDS) {
      if (data[field] !== undefined) {
        delete data[field];
        changes.push(`removed ${field}`);
      }
    }

    /** 步骤 4：迁移 date → created */
    if (data.date && !data.created) {
      const dateVal = String(data.date);
      const parsed = new Date(dateVal);
      if (!isNaN(parsed.getTime())) {
        data.created = parsed.toISOString().slice(0, 10);
      } else {
        data.created = dateVal;
      }
      delete data.date;
      changes.push(`date → created: ${data.created}`);
    } else if (data.date && data.created) {
      /** 两者都存在时移除 date */
      delete data.date;
      changes.push("removed redundant date (kept created)");
    }

    /** 步骤 5：格式化 created 日期 */
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

    /** 步骤 6：确保 project 字段与目录一致 */
    if (!data.project) {
      data.project = f.project;
      changes.push(`added project: ${f.project}`);
    } else if (data.project !== f.project) {
      changes.push(`project mismatch: dir=${f.project}, fm=${data.project}`);
    }

    if (changes.length === 0) continue;

    /** 步骤 7：写回文件 */
    if (!opts?.dryRun) {
      const content = matter.stringify(raw, data);
      fs.writeFileSync(abs, content, "utf-8");
    }

    results.push({ file: f.relativePath, changes });
  }

  /** 步骤 8：移动孤立文件到正确的项目目录 */
  const orphans = targetFiles.filter(
    (f) => f.project === "General" && !f.relativePath.endsWith("INDEX.md")
  );

  for (const f of orphans) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

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

    /** 如果 frontmatter 中指定了具体项目，移动文件 */
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

// ── 报告生成功能 ──────────────────────────────────────────────────────────

/**
 * @description 生成 Work 文件的汇总报告
 *
 * 按项目分组统计文件数量、状态分布和阻塞情况。
 *
 * @param vaultRoot - vault 根目录路径
 * @returns Work 报告
 */
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

  /** 按文件数量降序排列 */
  projects.sort((a, b) => b.fileCount - a.fileCount);

  return {
    totalFiles: files.length,
    totalProjects: byProject.size,
    projects,
    orphanFiles: orphans,
  };
}
