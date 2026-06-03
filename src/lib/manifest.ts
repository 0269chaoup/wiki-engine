/**
 * @file 批次清单管理模块
 *
 * 提供对 Inbox 批次清单（_manifest.yaml）的读写操作，包括：
 * - 读取/写入批次清单文件
 * - 更新清单状态字段
 * - 生成批次 ID
 * - 查找 Inbox 中的所有批次目录
 *
 * 清单文件使用 YAML frontmatter 格式存储在 _manifest.yaml 中。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { BatchManifest } from "./types.js";

/**
 * 清单文件名常量
 */
const MANIFEST_FILENAME = "_manifest.yaml";

/**
 * 从 Inbox 批次目录中读取批次清单
 *
 * @param batchDir - 批次目录的绝对路径
 * @returns 解析后的 BatchManifest 对象，文件不存在或解析失败时返回 null
 */
export function readManifest(batchDir: string): BatchManifest | null {
  const manifestPath = path.join(batchDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    /** 使用 gray-matter 解析 YAML frontmatter */
    const { data } = matter(raw);
    return data as unknown as BatchManifest;
  } catch {
    return null;
  }
}

/**
 * 将批次清单写入 Inbox 批次目录
 *
 * 使用 gray-matter 将清单数据序列化为 YAML frontmatter 格式。
 *
 * @param batchDir - 批次目录的绝对路径
 * @param manifest - 要写入的批次清单对象
 */
export function writeManifest(batchDir: string, manifest: BatchManifest): void {
  const manifestPath = path.join(batchDir, MANIFEST_FILENAME);
  /** 将清单数据序列化为 YAML frontmatter 字符串 */
  const yaml = matter.stringify("", manifest);
  fs.writeFileSync(manifestPath, yaml, "utf-8");
}

/**
 * 更新批次清单的状态字段
 *
 * 读取现有清单，修改状态后写回。
 * 如果清单不存在，则静默跳过。
 *
 * @param batchDir - 批次目录的绝对路径
 * @param status - 新的状态值（"pending" | "learning" | "archived"）
 */
export function updateManifestStatus(
  batchDir: string,
  status: BatchManifest["status"]
): void {
  const manifest = readManifest(batchDir);
  if (!manifest) return;
  manifest.status = status;
  writeManifest(batchDir, manifest);
}

/**
 * 根据主题 slug 生成批次 ID
 *
 * 格式：ingest-YYYYMMDD-{slug}
 * slug 会被清理：转小写、特殊字符替换为连字符、截断至 40 字符。
 *
 * @param slug - 主题标识符（支持中英文）
 * @returns 生成的批次 ID 字符串
 */
export function generateBatchId(slug: string): string {
  /** 获取当前日期（YYYYMMDD 格式） */
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  /** 清理 slug：小写化、替换非字母数字字符为连字符、去除首尾连字符 */
  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")  /** 保留中文字符 */
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `ingest-${date}-${safeSlug}`;
}

/**
 * 查找 Inbox 目录中的所有批次目录
 *
 * 通过目录名前缀 "ingest-" 识别批次目录。
 *
 * @param inboxDir - Inbox 目录的绝对路径
 * @returns 批次目录路径数组
 */
export function findBatches(inboxDir: string): string[] {
  if (!fs.existsSync(inboxDir)) return [];
  return fs.readdirSync(inboxDir)
    /** 过滤以 "ingest-" 开头的目录 */
    .filter(d => d.startsWith("ingest-"))
    .map(d => path.join(inboxDir, d))
    .filter(d => fs.statSync(d).isDirectory());
}
