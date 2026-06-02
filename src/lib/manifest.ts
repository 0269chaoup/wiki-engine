import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { BatchManifest } from "./types.js";

const MANIFEST_FILENAME = "_manifest.yaml";

/**
 * Read a batch manifest from an Inbox directory.
 */
export function readManifest(batchDir: string): BatchManifest | null {
  const manifestPath = path.join(batchDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const { data } = matter(raw);
    return data as unknown as BatchManifest;
  } catch {
    return null;
  }
}

/**
 * Write a batch manifest to an Inbox directory.
 */
export function writeManifest(batchDir: string, manifest: BatchManifest): void {
  const manifestPath = path.join(batchDir, MANIFEST_FILENAME);
  const yaml = matter.stringify("", manifest);
  fs.writeFileSync(manifestPath, yaml, "utf-8");
}

/**
 * Update manifest status field.
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
 * Generate a batch_id from a topic slug.
 * Format: ingest-YYYYMMDD-{slug}
 */
export function generateBatchId(slug: string): string {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `ingest-${date}-${safeSlug}`;
}

/**
 * Find all batch directories in Inbox.
 */
export function findBatches(inboxDir: string): string[] {
  if (!fs.existsSync(inboxDir)) return [];
  return fs.readdirSync(inboxDir)
    .filter(d => d.startsWith("ingest-"))
    .map(d => path.join(inboxDir, d))
    .filter(d => fs.statSync(d).isDirectory());
}
