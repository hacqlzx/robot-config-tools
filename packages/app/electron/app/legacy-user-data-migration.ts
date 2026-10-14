import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const LEGACY_APP_NAME = "app";
const MIGRATION_MARKER = ".legacy-user-data-migration-v1.json";
const CACHE_DIRECTORY_NAMES = new Set([
  "cache",
  "code cache",
  "gpucache",
  "dawncache",
  "grshadercache",
  "shadercache",
  "crashpad",
  "logs",
]);

type MigrationSummary = { copiedFiles: number; skippedFiles: number };

function isMissingError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isMissingError(error)) return false;
    throw error;
  }
}

async function copyMissingEntries(source: string, target: string, summary: MigrationSummary): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(target, { recursive: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      summary.skippedFiles += 1;
      continue;
    }

    if (entry.isDirectory() && CACHE_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
      summary.skippedFiles += 1;
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      try {
        const targetStat = await fs.stat(targetPath);
        if (!targetStat.isDirectory()) {
          summary.skippedFiles += 1;
          continue;
        }
      } catch (error) {
        if (!isMissingError(error)) throw error;
        await fs.mkdir(targetPath, { recursive: true });
      }
      await copyMissingEntries(sourcePath, targetPath, summary);
      continue;
    }

    if (!entry.isFile() || await pathExists(targetPath)) {
      summary.skippedFiles += 1;
      continue;
    }

    try {
      await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
      summary.copiedFiles += 1;
    } catch (error) {
      // A concurrently-created destination file is newer data and must remain untouched.
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        summary.skippedFiles += 1;
        continue;
      }
      throw error;
    }
  }
}

/** Copies persistent data from the former Electron userData directory without deleting or overwriting it. */
export async function migrateLegacyUserData(): Promise<void> {
  const target = app.getPath("userData");
  const legacy = path.join(app.getPath("appData"), LEGACY_APP_NAME);
  if (path.resolve(legacy).toLowerCase() === path.resolve(target).toLowerCase()) return;
  if (!await pathExists(legacy)) return;

  const marker = path.join(target, MIGRATION_MARKER);
  if (await pathExists(marker)) return;

  const summary: MigrationSummary = { copiedFiles: 0, skippedFiles: 0 };
  await copyMissingEntries(legacy, target, summary);

  const markerTemp = `${marker}.${process.pid}.tmp`;
  await fs.writeFile(markerTemp, JSON.stringify({
    version: 1,
    completedAt: new Date().toISOString(),
    source: legacy,
    copiedFiles: summary.copiedFiles,
    skippedFiles: summary.skippedFiles,
  }, null, 2), "utf8");
  try {
    await fs.rename(markerTemp, marker);
  } catch (error) {
    // Another app instance may have completed the same idempotent migration first.
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST" && await pathExists(marker)) {
      await fs.rm(markerTemp, { force: true });
    } else {
      throw error;
    }
  }
  console.info("[userData] Legacy data copied", { source: legacy, target, ...summary });
}

export async function migrateLegacyUserDataForStartup(): Promise<void> {
  try {
    await migrateLegacyUserData();
  } catch (error) {
    console.error("[userData] Legacy data migration failed; continuing startup with current userData", error);
  }
}
