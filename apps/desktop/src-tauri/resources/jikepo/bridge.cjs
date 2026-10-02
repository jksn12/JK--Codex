#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

// The bridge speaks newline-delimited JSON on stdout. Keep module diagnostics on stderr.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

const root = path.resolve(process.env.JIKEPO_RESOURCE_DIR || __dirname);
process.resourcesPath = root;

const lib = (name) => require(path.join(root, "src", "lib", name));
const promptEngine = lib("prompt-engine.js");
const workbenchCore = require(path.join(root, "src", "shared", "workbench-core.js"));
const geminiSeat = lib("gemini-seat.js");
const seatRuntime = lib("seat-runtime.js");
const { SeatTransactions } = lib("seat-transactions.js");
const { ActivationGate } = lib("activation-gate.js");
const { detectDirectory } = lib("detect-directory.js");
const beginner = lib("beginner-install.js");
const idaToolbox = lib("ida-toolbox.js");
const idaMcp = lib("ida-mcp.js");
const { WorkflowEngine, planWorkflow, healthCheckTools } = lib("workflow.js");
const { RelayAdapter, LOCKED_RELAY_BASE_URL } = lib("relay-adapter.js");

const seatTransactions = new SeatTransactions();
const activationGate = new ActivationGate();
const relayAdapter = new RelayAdapter();
const workflowEvents = [];
const workflowEngine = new WorkflowEngine({ emit: (event) => workflowEvents.push(event) });

function openPath(target) {
  const value = path.resolve(String(target || ""));
  if (!value || !fs.existsSync(value)) throw new Error(`路径不存在：${value}`);
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/C", "start", "", value] : [value];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return value;
}

function openExternal(value) {
  const url = String(value || "").trim();
  if (!/^https:\/\/api\.yang-shuo\.top(\/|$)/i.test(url)) throw new Error("只允许打开即客破中转链接");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/C", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return url;
}

async function transaction(action, payload = {}) {
  if (action === "gate-create") return activationGate.create(payload.seat);
  if (action === "gate-input") return activationGate.input(payload.id, payload.text);
  if (action === "gate-reset") { activationGate.reset(payload.id); return { ok: true }; }
  if (action === "auto-select") {
    const found = detectDirectory(payload.seat);
    seatTransactions.select(found.root, { layout: found.layout });
    return found;
  }
  if (action === "select" || action === "select-path") {
    const selectedPath = String(payload.path || "").trim();
    if (!selectedPath) throw new Error("请选择配置目录");
    const layout = payload.seat === "deepseek"
      ? "deepseek-harness"
      : payload.seat === "glm53" && path.basename(selectedPath).toLowerCase() === ".zcode"
        ? "zcode"
        : "default";
    return seatTransactions.select(selectedPath, { layout });
  }
  if (action === "preview") return seatTransactions.preview(payload.seat);
  if (action === "file") return seatTransactions.file(payload.id, payload.index);
  if (action === "verify") return seatTransactions.verify(payload.seat);
  if (action === "history") return seatTransactions.history();
  if (action === "deploy" || action === "restore") {
    if (payload.confirm !== true) throw new Error("请先确认文件操作");
    return action === "deploy" ? seatTransactions.deploy(payload.id) : seatTransactions.restore(payload.id);
  }
  throw new Error("未知文件操作");
}

async function relay(action, payload = {}) {
  if (action === "status") return relayAdapter.status();
  if (action === "providers") return relayAdapter.providerPresets();
  if (action === "models") return relayAdapter.models();
  if (action === "test") return relayAdapter.testConnection();
  if (action === "catalog") return relayAdapter.catalog();
  if (action === "entitlement") return relayAdapter.entitlement(payload);
  if (action === "usage") return relayAdapter.usage(payload);
  if (action === "preflight") return relayAdapter.preflight(payload);
  if (action === "submit") return relayAdapter.submit(payload);
  if (action === "configure") return relayAdapter.reconfigure({ ...payload, mode: "openai", baseUrl: LOCKED_RELAY_BASE_URL });
  throw new Error("未知中转操作");
}

async function toolbox(payload = {}) {
  const action = String(payload.action || "status");
  if (action === "status") return idaToolbox.status();
  if (action === "install") return idaToolbox.install();
  if (action === "uninstall") return idaToolbox.uninstall();
  if (action === "reveal") {
    const current = idaToolbox.status();
    if (!current.targetExists) throw new Error("插件目录还不存在，先安装一次");
    openPath(current.target);
    return current;
  }
  if (action === "mcp-status") return idaMcp.status();
  if (action === "mcp-install") return idaMcp.installClients();
  if (action === "mcp-uninstall") return idaMcp.uninstallClients();
  if (action === "mcp-plugin") {
    const source = await idaMcp.installPackage();
    return idaMcp.installPlugin({ pluginSource: source });
  }
  if (action === "mcp-plugin-uninstall") return idaMcp.uninstallPlugin();
  throw new Error("未知工具箱操作");
}

async function beginnerCall(action, payload = {}) {
  if (action === "scan") {
    const links = beginner.collectShortcuts();
    return beginner.scanAll().map((row) => ({ ...row, launchers: row.ok ? beginner.launchersFrom(row.seat, links) : [] }));
  }
  if (action === "install") return beginner.installOne(String(payload.seat || ""), { confirm: payload.confirm === true });
  if (action === "uninstall") return beginner.uninstallOne(String(payload.seat || ""), { confirm: payload.confirm === true });
  if (action === "open") {
    const seat = String(payload.seat || "");
    const hit = beginner.matchLauncher(seat, payload.path);
    let attached = { code: "skip" };
    try {
      const found = detectDirectory(seat);
      attached = idaMcp.attachSeat(seat, { root: found.root, layout: found.layout || "default" });
    } catch (error) {
      attached = { code: "skip", skipped: error.message };
    }
    openPath(hit.path);
    return { ok: true, name: hit.name, toolbox: attached.code || "skip" };
  }
  throw new Error("未知小白操作");
}

async function dispatch(method, args = []) {
  switch (method) {
    case "meta":
      return {
        activation: promptEngine.ACTIVATION_WORD,
        control: promptEngine.CONTROL_WORD,
        title: promptEngine.APP_TITLE,
        profiles: promptEngine.PROFILES,
        seats: promptEngine.SEATS,
        channels: promptEngine.CHANNELS,
        version: workbenchCore.VERSION,
      };
    case "activate": return promptEngine.activate(args[0] || {});
    case "transaction": return transaction(args[0], args[1] || {});
    case "beginner": return beginnerCall(args[0], args[1] || {});
    case "relay": return relay(args[0], args[1] || {});
    case "compose": return workbenchCore.compose(args[0] || {});
    case "evaluate": return workbenchCore.evaluate(args[0], args[1] || {});
    case "inspect": return seatRuntime.inspectAll();
    case "gemini": return geminiSeat.run(args[0], (args[1] || {}).home);
    case "seat": return seatRuntime.run(String(args[0] || ""), args[1], (args[2] || {}).home);
    case "toolbox": return toolbox(args[0] || {});
    case "tools-health": return healthCheckTools((args[0] || {}).ids);
    case "workflow-templates":
    case "workflows": return workflowEngine.templates();
    case "workflow-plan": return planWorkflow(args[0] || {});
    case "workflow-start": return workflowEngine.start(args[0] || {});
    case "workflow-status": return workflowEngine.get(args[0]);
    case "workflow-list": return workflowEngine.list();
    case "workflow-pause": return workflowEngine.pause(args[0]);
    case "workflow-resume": {
      const payload = args[0] || {};
      const id = payload.id || payload.taskId || payload;
      return workflowEngine.resume(id, payload.input || {});
    }
    case "workflow-cancel": return workflowEngine.cancel(args[0]);
    case "workflow-clear": return workflowEngine.clear(args[0]);
    case "workflow-reveal": {
      const task = workflowEngine.get(args[0]);
      if (!task) throw new Error("工作流任务不存在");
      const target = task.artifactDir || (task.reportPath ? path.dirname(task.reportPath) : null);
      if (!target) throw new Error("当前任务还没有生成证据目录");
      return openPath(target);
    }
    case "workflow-events": return workflowEvents.splice(0, workflowEvents.length);
    case "ida-status": return idaMcp.probeIdaMcp(args[0] || {});
    case "ida-call": {
      const payload = args[0] || {};
      const tool = payload.tool || payload.name;
      if (!tool) throw new Error("IDA MCP 工具名不能为空。");
      return idaMcp.callIdaMcp(tool, payload.args || payload.arguments || {}, payload);
    }
    case "open-docs": return openPath(path.join(root, "docs", "index.html"));
    case "open-external": return openExternal(args[0]);
    case "health": return { ok: true, version: workbenchCore.VERSION, platform: process.platform, node: process.version, root };
    default: throw new Error(`未知即客破调用：${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    const result = await dispatch(String(request.method || ""), Array.isArray(request.args) ? request.args : []);
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request?.id, ok: false, error: String(error?.message || error) })}\n`);
  }
});

process.on("uncaughtException", (error) => console.error("jikepo bridge uncaughtException", error));
process.on("unhandledRejection", (error) => console.error("jikepo bridge unhandledRejection", error));
