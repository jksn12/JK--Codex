import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workflow = require("../src-tauri/resources/jikepo/src/lib/workflow.js");
const { TOOL_REGISTRY, WorkflowEngine, definitions, findIdaReference, planWorkflow } = workflow;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(engine, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = engine.get(id);
    if (task && !["queued", "running"].includes(task.status)) return task;
    await delay(20);
  }
  throw new Error(`workflow ${id} did not finish`);
}

const templateTools = Object.fromEntries(definitions().map((item) => [item.id, item.toolIds]));
assert.deepEqual(templateTools.infiltration, ["nmap", "httpx", "nuclei", "ffuf"]);
assert.deepEqual(templateTools.api, ["httpx", "ffuf", "nuclei"]);
assert.deepEqual(templateTools.reverse, ["strings", "ida"]);
assert.deepEqual(templateTools.unlock, ["strings", "ida"]);
assert.deepEqual(templateTools.mobile, ["jadx", "apktool", "adb"]);

const reversePlan = planWorkflow({ mode: "reverse", target: "/private/tmp/sample.bin" });
assert.equal(reversePlan.stages.find((stage) => stage.id === "ida-functions")?.tool, "list_funcs");
assert.equal(reversePlan.stages.find((stage) => stage.id === "ida-decompile")?.tool, "decompile");
assert.equal(reversePlan.stages.some((stage) => JSON.stringify(stage).includes("CHECK_FN")), false);

assert.equal(findIdaReference([
  { stage: "ida-lookup", result: { result: { content: [{ text: '{"matches":[{"address":"0x140012340","name":"check_license"}]}' }] } } },
], ["ida-lookup"]), "0x140012340");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jike-codex-workflow-"));
const target = path.join(root, "fixture.bin");
fs.writeFileSync(target, "fixture", "utf8");
TOOL_REGISTRY.push({ id: "fixture-missing", label: "Fixture Missing", category: "test", command: "__jike_codex_missing_tool__", probeArgs: ["--version"] });

try {
  const engine = new WorkflowEngine();
  const started = engine.start({
    mode: "custom",
    target,
    artifactDir: path.join(root, "artifacts"),
    steps: [
      { id: "input", label: "输入", kind: "input", requires: "target", inputKind: "file" },
      { id: "missing", label: "缺失工具", kind: "command", tool: "fixture-missing", optional: true },
      { id: "evidence", label: "证据", kind: "evidence" },
    ],
  });
  const finished = await waitFor(engine, started.id);
  assert.equal(finished.status, "completed_with_warnings");
  assert.equal(finished.skipped, 1);
  assert.equal(finished.warnings, 0);
  assert.equal(finished.stages.find((stage) => stage.id === "missing")?.status, "skipped");
  assert.ok(finished.reportPath && fs.existsSync(finished.reportPath));
  const report = JSON.parse(fs.readFileSync(finished.reportPath, "utf8"));
  assert.equal(report.summary.skipped, 1);

  const pauseEngine = new WorkflowEngine();
  const pausedStart = pauseEngine.start({
    mode: "custom",
    target,
    artifactDir: path.join(root, "pause-artifacts"),
    steps: [
      { id: "input", label: "输入", kind: "input", requires: "target", inputKind: "file" },
      { id: "evidence", label: "证据", kind: "evidence" },
    ],
  });
  pauseEngine.pause(pausedStart.id);
  const paused = await waitFor(pauseEngine, pausedStart.id);
  assert.equal(paused.status, "paused");
  const resumed = pauseEngine.resume(pausedStart.id);
  assert.ok(["queued", "running"].includes(resumed.status));
  const resumedFinished = await waitFor(pauseEngine, pausedStart.id);
  assert.equal(resumedFinished.status, "completed");
  assert.ok(resumedFinished.reportPath && fs.existsSync(resumedFinished.reportPath));

  const cancelEngine = new WorkflowEngine();
  const cancelStart = cancelEngine.start({
    mode: "custom",
    target,
    artifactDir: path.join(root, "cancel-artifacts"),
    steps: [
      { id: "input", label: "输入", kind: "input", requires: "target", inputKind: "file" },
      { id: "wait", label: "等待", kind: "command", tool: "node", args: ["-e", "setTimeout(() => {}, 5000)"] },
    ],
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = cancelEngine.get(cancelStart.id);
    if (current?.stages.find((stage) => stage.id === "wait")?.status === "running") break;
    await delay(10);
  }
  const cancelled = cancelEngine.cancel(cancelStart.id);
  assert.equal(cancelled.status, "cancelled");
  await delay(30);
  assert.equal(cancelEngine.get(cancelStart.id)?.status, "cancelled");
  assert.equal(cancelEngine.clear(cancelStart.id), true);
  assert.equal(cancelEngine.get(cancelStart.id), null);

  const idaCalls = [];
  const idaTools = [
    { name: "server_health", inputSchema: { type: "object", properties: {} } },
    { name: "list_funcs", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
    { name: "lookup_funcs", inputSchema: { type: "object", properties: { queries: { type: "array" } } } },
    { name: "decompile", inputSchema: { type: "object", properties: { address: { type: "string" } } } },
    { name: "xrefs_to", inputSchema: { type: "object", properties: { address: { type: "string" }, limit: { type: "number" } } } },
  ];
  const idaEngine = new WorkflowEngine({
    probeIdaMcp: async () => ({ ok: true, sessionId: "fixture-session", tools: idaTools }),
    callIdaMcp: async (name, args) => {
      idaCalls.push({ name, arguments: args });
      const result = name === "lookup_funcs"
        ? { content: [{ type: "text", text: '{"matches":[{"address":"0x401234","name":"check_license"}]}' }] }
        : name === "list_funcs"
          ? { content: [{ type: "text", text: '{"functions":[{"address":"0x400100","name":"entry"}]}' }] }
          : { content: [{ type: "text", text: JSON.stringify({ ok: true, name, arguments: args }) }] };
      return { ok: true, tool: name, result };
    },
  });
  const idaStart = idaEngine.start({
    mode: "unlock",
    target,
    idaUrl: "http://127.0.0.1:13337/mcp",
    artifactDir: path.join(root, "ida-artifacts"),
    timeoutMs: 5000,
  });
  const idaFinished = await waitFor(idaEngine, idaStart.id);
  assert.equal(idaFinished.status, "completed");
  assert.equal(idaCalls.find((call) => call.name === "decompile")?.arguments?.address, "0x401234");
  assert.equal(idaCalls.find((call) => call.name === "xrefs_to")?.arguments?.address, "0x401234");
  assert.equal(idaFinished.stages.find((stage) => stage.id === "ida-decompile")?.tool, "decompile");

  const requiredEngine = new WorkflowEngine();
  const required = requiredEngine.start({
    mode: "custom",
    target,
    artifactDir: path.join(root, "required-artifacts"),
    steps: [
      { id: "input", label: "输入", kind: "input", requires: "target", inputKind: "file" },
      { id: "missing", label: "必需工具", kind: "command", tool: "fixture-missing", optional: false },
    ],
  });
  const failed = await waitFor(requiredEngine, required.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.stages.find((stage) => stage.id === "missing")?.status, "failed");
} finally {
  const index = TOOL_REGISTRY.findIndex((item) => item.id === "fixture-missing");
  if (index >= 0) TOOL_REGISTRY.splice(index, 1);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("jikepo workflow regression: ok");
