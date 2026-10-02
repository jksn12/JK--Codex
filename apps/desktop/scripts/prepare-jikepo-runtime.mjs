import { copyFile, chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const resourceDir = path.resolve(here, "..", "src-tauri", "resources", "jikepo");
const runtimeDir = path.join(resourceDir, "runtime");
const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimeTarget = path.join(runtimeDir, runtimeName);
await mkdir(runtimeDir, { recursive: true });

const runtimeSource = process.execPath;
let shouldCopyRuntime = true;
try {
  const [sourceStat, targetStat] = await Promise.all([stat(runtimeSource), stat(runtimeTarget)]);
  shouldCopyRuntime = sourceStat.size !== targetStat.size || sourceStat.mtimeMs > targetStat.mtimeMs;
} catch {
  shouldCopyRuntime = true;
}
if (shouldCopyRuntime) await copyFile(runtimeSource, runtimeTarget);
if (process.platform !== "win32") await chmod(runtimeTarget, 0o755);

const archive = path.join(resourceDir, "jikepo-backend.zip");
const entries = ["bridge.cjs", "package.json", "src", "docs", "ida-zh-cn"];

async function newestMtime(target) {
  const info = await stat(target);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const item of await readdir(target)) {
    newest = Math.max(newest, await newestMtime(path.join(target, item)));
  }
  return newest;
}

let archiveFresh = false;
try {
  const archiveStat = await stat(archive);
  let newestSource = 0;
  for (const entry of entries) newestSource = Math.max(newestSource, await newestMtime(path.join(resourceDir, entry)));
  archiveFresh = archiveStat.mtimeMs >= newestSource;
} catch {
  archiveFresh = false;
}

if (!archiveFresh) {
  await rm(archive, { force: true });
  let result;
  if (process.platform === "win32") {
    const quotedEntries = entries.map((entry) => `'${path.join(resourceDir, entry).replaceAll("'", "''")}'`).join(",");
    const script = `Compress-Archive -Path ${quotedEntries} -DestinationPath '${archive.replaceAll("'", "''")}' -Force`;
    result = spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
  } else {
    result = spawnSync("zip", ["-qr", archive, ...entries], { cwd: resourceDir, stdio: "inherit" });
  }
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`zip exited with status ${result.status}`);
  }
}

console.log(`Jikepo Node runtime ready: ${runtimeTarget}`);
console.log(`Jikepo backend archive ready: ${archive}`);
