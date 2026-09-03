import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(appRoot, "..", "..");
const releaseRoot = path.join(appRoot, "release");
const processStateDir = path.join(appRoot, "node_modules", ".cache", "robot-config-tools", "dev-processes");
const dryRun = process.argv.includes("--dry-run");

function normalizeResult(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function runPowerShell(script, extraEnv = {}) {
  const output = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    },
  ).trim();
  return output ? JSON.parse(output) : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readTrackedDevProcesses() {
  if (!fs.existsSync(processStateDir)) return [];

  const states = [];
  for (const entry of fs.readdirSync(processStateDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const statePath = path.join(processStateDir, entry.name);
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const sameApp = path.resolve(String(state.appRoot || "")).toLowerCase() === appRoot.toLowerCase();
      if (sameApp && Number.isInteger(state.pid) && state.pid > 0 && state.pid !== process.pid) {
        states.push({ ...state, statePath });
      } else {
        fs.rmSync(statePath, { force: true });
      }
    } catch {
      fs.rmSync(statePath, { force: true });
    }
  }
  return states;
}

function queryProcess(pid) {
  if (process.platform !== "win32") return isProcessAlive(pid) ? { Id: pid } : null;
  try {
    return runPowerShell(
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8
$process = Get-Process -Id $env:RCT_PROCESS_ID -ErrorAction SilentlyContinue
if ($null -ne $process) {
  [pscustomobject]@{
    Id = $process.Id
    Name = $process.ProcessName
    Path = $process.Path
    StartedAt = $process.StartTime.ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Compress
}`,
      { RCT_PROCESS_ID: String(pid) },
    );
  } catch {
    return null;
  }
}

function trackedProcessStillMatches(state) {
  const processInfo = queryProcess(state.pid);
  if (!processInfo) return false;
  if (String(processInfo.Name || "").toLowerCase() !== "node") return false;

  const expectedStart = Date.parse(state.startedAt);
  const actualStart = Date.parse(processInfo.StartedAt);
  if (!Number.isFinite(expectedStart) || !Number.isFinite(actualStart)) return false;
  if (Math.abs(expectedStart - actualStart) > 5_000) return false;

  if (state.executable && processInfo.Path) {
    return path.resolve(processInfo.Path).toLowerCase() === path.resolve(state.executable).toLowerCase();
  }
  return true;
}

function discoverWorkspaceProcesses() {
  if (process.platform !== "win32") return [];
  try {
    return normalizeResult(runPowerShell(
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8
$workspaceRoot = [IO.Path]::GetFullPath($env:RCT_WORKSPACE_ROOT).TrimEnd('\\') + '\\'
$releaseRoot = [IO.Path]::GetFullPath($env:RCT_RELEASE_ROOT).TrimEnd('\\') + '\\'
$pdalRoot = [IO.Path]::GetFullPath($env:RCT_PDAL_ROOT).TrimEnd('\\') + '\\'
$potreeRoot = [IO.Path]::GetFullPath($env:RCT_POTREE_ROOT).TrimEnd('\\') + '\\'
$comparison = [StringComparison]::OrdinalIgnoreCase
$found = @()

Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $processPath = if ($_.Path) { [IO.Path]::GetFullPath($_.Path) } else { '' }
    $isReleasedApp = $processPath.StartsWith($releaseRoot, $comparison)
    $isProduct = $_.ProcessName -eq $env:RCT_PRODUCT_NAME
    $isSourceTool = $processPath.StartsWith($pdalRoot, $comparison) -or $processPath.StartsWith($potreeRoot, $comparison)
    $isPackagedTool = ($_.ProcessName -in @('pdal', 'PotreeConverter')) -and (
      $processPath.StartsWith($workspaceRoot, $comparison) -or
      $processPath.StartsWith($releaseRoot, $comparison) -or
      $processPath -match '\\resources\\(pdal-runtime|potree)\\'
    )
    $isBundledTool = $isSourceTool -or $isPackagedTool
    if ($isReleasedApp -or $isProduct -or $isBundledTool) {
      $found += [pscustomobject]@{ Id = $_.Id; Kind = 'application'; Name = $_.ProcessName; Path = $processPath }
    }
  } catch {}
}

Get-Process -Name 'esbuild' -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $processPath = [IO.Path]::GetFullPath($_.Path)
    if ($processPath.StartsWith($workspaceRoot, $comparison) -and $null -ne $_.Parent) {
      $found += [pscustomobject]@{ Id = $_.Parent.Id; Kind = 'dev-server'; Name = $_.Parent.ProcessName; Path = $_.Parent.Path }
    }
  } catch {}
}

$found | Sort-Object Id -Unique | ConvertTo-Json -Compress`,
      {
        RCT_WORKSPACE_ROOT: workspaceRoot,
        RCT_RELEASE_ROOT: releaseRoot,
        RCT_PDAL_ROOT: path.join(appRoot, "src", "pdal-runtime"),
        RCT_POTREE_ROOT: path.join(appRoot, "src", "potree-core", "PotreeConverter_2.1.3"),
        RCT_PRODUCT_NAME: "七宝智图",
      },
    ));
  } catch (error) {
    console.warn(`[package:prepare] 无法扫描遗留进程，将继续使用 PID 记录: ${error.message}`);
    return [];
  }
}

function stopProcessTree(pid) {
  if (!isProcessAlive(pid)) return;
  if (dryRun) return;

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: "pipe",
      });
    } catch {
      try {
        runPowerShell(
          "Stop-Process -Id $env:RCT_PROCESS_ID -Force -ErrorAction SilentlyContinue",
          { RCT_PROCESS_ID: String(pid) },
        );
      } catch {
        // Some Electron child processes reject direct termination. Closing the
        // main process later in the same pass will also close those children.
      }
    }
    return;
  }

  process.kill(pid, "SIGTERM");
}

async function waitForExit(pids, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isProcessAlive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const remaining = pids.filter(isProcessAlive);
  if (remaining.length > 0) throw new Error(`以下进程无法关闭: ${remaining.join(", ")}`);
}

async function main() {
  const trackedStates = readTrackedDevProcesses();
  const trackedProcesses = trackedStates
    .filter(trackedProcessStillMatches)
    .map((state) => ({ Id: state.pid, Kind: "dev-server", Name: "node", Path: state.executable }));
  const discoveredProcesses = discoverWorkspaceProcesses();
  const processById = new Map();
  for (const item of [...trackedProcesses, ...discoveredProcesses]) {
    const pid = Number(item.Id);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) processById.set(pid, item);
  }

  const processes = Array.from(processById.values());
  if (processes.length > 0) {
    console.log(`[package:prepare] ${dryRun ? "发现" : "正在关闭"} ${processes.length} 个本项目遗留进程:`);
    for (const item of processes) {
      console.log(`  - PID ${item.Id} ${item.Name || "unknown"} (${item.Kind})`);
      stopProcessTree(Number(item.Id));
    }
    if (!dryRun) await waitForExit(processes.map((item) => Number(item.Id)));
  } else {
    console.log("[package:prepare] 未发现本项目遗留进程");
  }

  if (dryRun) {
    console.log(`[package:prepare] 将清空 ${releaseRoot}`);
    return;
  }

  for (const state of trackedStates) fs.rmSync(state.statePath, { force: true });
  await fs.promises.rm(releaseRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 });
  console.log(`[package:prepare] 已清空 ${releaseRoot}`);
}

main().catch((error) => {
  console.error(`[package:prepare] 准备失败: ${error.message}`);
  process.exitCode = 1;
});
