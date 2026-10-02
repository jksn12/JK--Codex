import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  CheckCircle2,
  Clipboard,
  FileCode2,
  FolderOpen,
  Gauge,
  History,
  Loader2,
  Play,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
  WandSparkles,
  XCircle,
} from "lucide-react";
import type { AppLanguage } from "../components/AppShell";
import { Button, Checkbox, StatusBadge, cx } from "../components/ui";
import "../styles/jikepo-page.css";

export type JikepoSection = "install" | "packs" | "relay" | "workflow" | "toolbox" | "composer";
type JsonObject = Record<string, unknown>;

type SeatScan = {
  ok: boolean;
  seat: string;
  name: string;
  line: string;
  root: string;
  exists: boolean;
  source: string;
  layout: string;
  launchers?: Array<{ name?: string; path?: string }>;
};

type PackHistory = {
  id: string;
  seat: string;
  at: string;
  status: string;
  files: number;
};

type RelayProvider = {
  id: string;
  label: string;
  model: string;
  reasoning?: string;
  description?: string;
};

type WorkflowTemplate = {
  id: string;
  label: string;
  description: string;
  toolIds: string[];
  stages: Array<{ id: string; label: string; kind: string; tool?: string | null; optional?: boolean }>;
};

type WorkflowTask = {
  id?: string;
  taskId?: string;
  status?: string;
  label?: string;
  target?: string;
  currentStage?: { id?: string; label?: string } | null;
  completed?: number;
  failed?: number;
  stageCount?: number;
  error?: string | null;
  stages?: Array<{
    id: string;
    label: string;
    kind: string;
    tool?: string | null;
    status: string;
    optional?: boolean;
    result?: JsonObject | null;
  }>;
};

type ToolHealth = {
  checkedAt?: string;
  platform?: string;
  available?: number;
  total?: number;
  tools?: Array<{ id: string; label: string; category: string; ok: boolean; detail?: string; error?: string }>;
};

type JikepoMeta = {
  activation?: string;
  control?: string;
  version?: string;
  profiles?: Array<{ id: string; label: string }>;
  seats?: Array<{ id: string; name: string; tag: string }>;
  channels?: Array<{ id: string; label: string }>;
};

const SEAT_LABELS: Record<string, string> = {
  codex: "Codex / GPT-6 Astra",
  claude: "Claude Code",
  grok: "Grok 4.7",
  deepseek: "DeepSeek Harness",
  glm53: "GLM / ZCode",
  gemini: "Gemini",
  doubao: "豆包",
  workbuddy: "WorkBuddy",
  cursor: "Cursor",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "操作失败");
}

async function callJikepo<T>(method: string, args: unknown[] = []): Promise<T> {
  return invoke<T>("jikepo_call", { method, args });
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function JsonResult({ value, empty = "暂无结果", maxHeight = 360 }: { value: unknown; empty?: string; maxHeight?: number }) {
  return (
    <pre className="jk-json-result" style={{ maxHeight }}>
      {value == null ? empty : stringify(value)}
    </pre>
  );
}

function PaneHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="jk-pane-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions && <div className="jk-pane-actions">{actions}</div>}
    </div>
  );
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cx("jk-field", wide && "jk-field--wide")}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export type JikepoRelayProvider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: string;
};

export type JikepoPageProps = {
  lang: AppLanguage;
  section: JikepoSection;
  embedded?: boolean;
  relayProvider?: JikepoRelayProvider | null;
};

export function JikepoPage({ lang, section, embedded = false, relayProvider = null }: JikepoPageProps) {
  const [busy, setBusy] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [meta, setMeta] = React.useState<JikepoMeta | null>(null);
  const [runtime, setRuntime] = React.useState<JsonObject | null>(null);

  const [seats, setSeats] = React.useState<SeatScan[]>([]);
  const [selectedSeats, setSelectedSeats] = React.useState<Set<string>>(() => new Set());

  const [packSeat, setPackSeat] = React.useState("codex");
  const [packRoot, setPackRoot] = React.useState("");
  const [packPreview, setPackPreview] = React.useState<JsonObject | null>(null);
  const [packVerify, setPackVerify] = React.useState<JsonObject | null>(null);
  const [packHistory, setPackHistory] = React.useState<PackHistory[]>([]);

  const [relayKey, setRelayKey] = React.useState("");
  const [relayStatus, setRelayStatus] = React.useState<JsonObject | null>(null);
  const [relayProviders, setRelayProviders] = React.useState<RelayProvider[]>([]);
  const [relayModel, setRelayModel] = React.useState("gpt-6-astra");
  const [relayModels, setRelayModels] = React.useState<string[]>([]);
  const [relayUsage, setRelayUsage] = React.useState<JsonObject | null>(null);
  const [relayCatalog, setRelayCatalog] = React.useState<JsonObject | null>(null);

  const [workflowTemplates, setWorkflowTemplates] = React.useState<WorkflowTemplate[]>([]);
  const [workflowMode, setWorkflowMode] = React.useState("infiltration");
  const [workflowTarget, setWorkflowTarget] = React.useState("");
  const [workflowWordlist, setWorkflowWordlist] = React.useState("");
  const [workflowArtifactDir, setWorkflowArtifactDir] = React.useState("");
  const [workflowTimeout, setWorkflowTimeout] = React.useState(45);
  const [workflowPlan, setWorkflowPlan] = React.useState<JsonObject | null>(null);
  const [workflowTask, setWorkflowTask] = React.useState<WorkflowTask | null>(null);
  const [toolHealth, setToolHealth] = React.useState<ToolHealth | null>(null);
  const [idaUrl, setIdaUrl] = React.useState("http://127.0.0.1:13337/mcp");
  const [idaStatus, setIdaStatus] = React.useState<JsonObject | null>(null);
  const [idaTool, setIdaTool] = React.useState("server_health");
  const [idaArgs, setIdaArgs] = React.useState("{}");
  const [idaResult, setIdaResult] = React.useState<JsonObject | null>(null);

  const [toolboxStatus, setToolboxStatus] = React.useState<JsonObject | null>(null);
  const [mcpStatus, setMcpStatus] = React.useState<JsonObject | null>(null);

  const [composeGoal, setComposeGoal] = React.useState("");
  const [composeContext, setComposeContext] = React.useState("");
  const [composeConstraints, setComposeConstraints] = React.useState("");
  const [composeSeat, setComposeSeat] = React.useState("codex");
  const [composeProfile, setComposeProfile] = React.useState("builder");
  const [composeFormat, setComposeFormat] = React.useState("markdown");
  const [composeResult, setComposeResult] = React.useState<JsonObject | null>(null);
  const [activationChannel, setActivationChannel] = React.useState("REVERSE");
  const [activationPrompt, setActivationPrompt] = React.useState("");
  const [activationResult, setActivationResult] = React.useState<JsonObject | null>(null);
  const [evaluationText, setEvaluationText] = React.useState("");
  const [evaluationKeywords, setEvaluationKeywords] = React.useState("");
  const [evaluationResult, setEvaluationResult] = React.useState<JsonObject | null>(null);

  const run = React.useCallback(async <T,>(key: string, task: () => Promise<T>, success?: string): Promise<T | null> => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await task();
      if (success) setNotice(success);
      return result;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setBusy("");
    }
  }, []);

  const loadRuntime = React.useCallback(async () => {
    const [metaResult, runtimeResult] = await Promise.all([
      callJikepo<JikepoMeta>("meta"),
      callJikepo<JsonObject>("health"),
    ]);
    setMeta(metaResult);
    setRuntime(runtimeResult);
  }, []);

  const scanSeats = React.useCallback(async () => {
    const rows = await run("scan", () => callJikepo<SeatScan[]>("beginner", ["scan", {}]));
    if (!rows) return;
    setSeats(rows);
    setSelectedSeats(new Set(rows.filter((row) => row.exists).map((row) => row.seat)));
  }, [run]);

  const loadPacks = React.useCallback(async (seat = packSeat) => {
    const result = await run("pack-load", async () => {
      const root = await callJikepo<{ root?: string }>("transaction", ["auto-select", { seat }]);
      const [preview, verify, history] = await Promise.all([
        callJikepo<JsonObject>("transaction", ["preview", { seat }]),
        callJikepo<JsonObject>("transaction", ["verify", { seat }]),
        callJikepo<PackHistory[]>("transaction", ["history", {}]),
      ]);
      return { root, preview, verify, history };
    });
    if (!result) return;
    setPackRoot(result.root.root || "");
    setPackPreview(result.preview);
    setPackVerify(result.verify);
    setPackHistory(result.history);
  }, [packSeat, run]);

  const loadRelay = React.useCallback(async () => {
    const result = await run("relay-load", async () => {
      const [status, providers, models] = await Promise.all([
        callJikepo<JsonObject>("relay", ["status", {}]),
        callJikepo<RelayProvider[]>("relay", ["providers", {}]),
        callJikepo<{ data?: Array<{ id?: string }> }>("relay", ["models", {}]),
      ]);
      return { status, providers, models };
    });
    if (!result) return;
    setRelayStatus(result.status);
    setRelayProviders(result.providers);
    const ids = (result.models.data || []).map((item) => item.id || "").filter(Boolean);
    setRelayModels(ids);
    if (ids.length && !ids.includes(relayModel)) setRelayModel(ids[0]);
  }, [relayModel, run]);

  const loadWorkflow = React.useCallback(async () => {
    const result = await run("workflow-load", async () => {
      const [templates, health] = await Promise.all([
        callJikepo<WorkflowTemplate[]>("workflow-templates"),
        callJikepo<ToolHealth>("tools-health", [{}]),
      ]);
      return { templates, health };
    });
    if (!result) return;
    setWorkflowTemplates(result.templates);
    setToolHealth(result.health);
  }, [run]);

  const loadToolbox = React.useCallback(async () => {
    const result = await run("toolbox-load", async () => {
      const [toolbox, mcp] = await Promise.all([
        callJikepo<JsonObject>("toolbox", [{ action: "status" }]),
        callJikepo<JsonObject>("toolbox", [{ action: "mcp-status" }]),
      ]);
      return { toolbox, mcp };
    });
    if (!result) return;
    setToolboxStatus(result.toolbox);
    setMcpStatus(result.mcp);
  }, [run]);

  React.useEffect(() => {
    void loadRuntime().catch((caught) => setError(messageOf(caught)));
    if (section === "install") void scanSeats();
  }, [loadRuntime, scanSeats, section]);

  React.useEffect(() => {
    if (!relayProvider) return;
    setRelayKey(relayProvider.apiKey || "");
    if (relayProvider.model) setRelayModel(relayProvider.model);
  }, [relayProvider?.apiKey, relayProvider?.model, relayProvider?.name]);

  React.useEffect(() => {
    if (section === "packs" && !packPreview) void loadPacks();
    if (section === "relay" && !relayStatus) void loadRelay();
    if (section === "workflow" && !workflowTemplates.length) void loadWorkflow();
    if (section === "toolbox" && !toolboxStatus) void loadToolbox();
  }, [section, loadPacks, loadRelay, loadToolbox, loadWorkflow, packPreview, relayStatus, toolboxStatus, workflowTemplates.length]);

  React.useEffect(() => {
    const taskId = workflowTask?.taskId || workflowTask?.id;
    if (!taskId || !["queued", "running", "paused", "needs-input"].includes(workflowTask?.status || "")) return;
    const timer = window.setInterval(() => {
      void callJikepo<WorkflowTask>("workflow-status", [taskId])
        .then((task) => setWorkflowTask(task))
        .catch((caught) => setError(messageOf(caught)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [workflowTask?.id, workflowTask?.status, workflowTask?.taskId]);

  const mutateSeats = async (action: "install" | "uninstall", targets: string[]) => {
    if (!targets.length) return;
    const verb = action === "install" ? "安装" : "卸载";
    if (!window.confirm(`确认${verb} ${targets.length} 个席位？\n\n每个席位都会先做备份，操作完成后可在席位包页面回滚。`)) return;
    const result = await run(`seat-${action}`, async () => {
      const outputs: unknown[] = [];
      for (const seat of targets) outputs.push(await callJikepo("beginner", [action, { seat, confirm: true }]));
      return outputs;
    }, `${verb}完成`);
    if (result) await scanSeats();
  };

  const choosePackDirectory = async () => {
    const selected = await invoke<{ canceled: boolean; path?: string }>("jikepo_select_directory", { seat: packSeat });
    if (selected.canceled || !selected.path) return;
    const result = await run("pack-directory", async () => {
      await callJikepo("transaction", ["select-path", { seat: packSeat, path: selected.path }]);
      const [preview, verify] = await Promise.all([
        callJikepo<JsonObject>("transaction", ["preview", { seat: packSeat }]),
        callJikepo<JsonObject>("transaction", ["verify", { seat: packSeat }]),
      ]);
      return { preview, verify };
    }, "配置目录已切换");
    if (!result) return;
    setPackRoot(selected.path);
    setPackPreview(result.preview);
    setPackVerify(result.verify);
  };

  const deployPack = async () => {
    const id = String(packPreview?.id || "");
    if (!id) return;
    if (!window.confirm(`确认把 ${SEAT_LABELS[packSeat] || packSeat} 席位包写入：\n${packRoot}\n\n原文件会先备份。`)) return;
    const result = await run("pack-deploy", () => callJikepo<JsonObject>("transaction", ["deploy", { id, confirm: true }]), "席位包已部署");
    if (result) await loadPacks(packSeat);
  };

  const restorePack = async (id: string) => {
    if (!window.confirm("确认恢复这个备份版本？有冲突的文件会中止，不会强行覆盖。")) return;
    const result = await run("pack-restore", () => callJikepo<JsonObject>("transaction", ["restore", { id, confirm: true }]), "备份已恢复");
    if (result) await loadPacks(packSeat);
  };

  const configureRelay = async () => {
    const effectiveKey = (relayProvider?.apiKey || relayKey).trim();
    if (!effectiveKey) {
      setError("当前供应商没有可用的 API Key，请先在上方编辑供应商配置");
      return;
    }
    const result = await run("relay-test", async () => {
      await callJikepo("relay", ["configure", { authToken: effectiveKey, wireApi: relayProvider?.wireApi || "responses" }]);
      const test = await callJikepo<JsonObject & { models?: unknown }>("relay", ["test", {}]);
      const optional = async (action: "usage" | "catalog") => {
        try {
          return { value: await callJikepo<JsonObject>("relay", [action, {}]), warning: "" };
        } catch (caught) {
          return { value: { available: false, error: messageOf(caught) }, warning: messageOf(caught) };
        }
      };
      const [usageResult, catalogResult, status] = await Promise.all([
        optional("usage"),
        optional("catalog"),
        callJikepo<JsonObject>("relay", ["status", {}]),
      ]);
      return {
        test,
        usage: usageResult.value,
        catalog: catalogResult.value,
        status,
        warnings: [usageResult.warning, catalogResult.warning].filter(Boolean),
      };
    });
    if (!result) return;
    setRelayStatus({ ...result.status, test: result.test });
    setRelayUsage(result.usage);
    setRelayCatalog(result.catalog);
    const modelPayload = result.test.models as { data?: unknown[] } | unknown[] | undefined;
    const modelItems = Array.isArray(modelPayload)
      ? modelPayload
      : Array.isArray(modelPayload?.data)
        ? modelPayload.data
        : [];
    const ids = modelItems
      .map((item) => typeof item === "string" ? item : String((item as { id?: string }).id || ""))
      .filter(Boolean);
    if (ids.length) {
      setRelayModels(ids);
      if (!ids.includes(relayModel)) setRelayModel(ids[0]);
    }
    setNotice(result.warnings.length
      ? `模型读取完成；${result.warnings.join("；")}`
      : "模型、用量和目录读取完成");
  };

  const relayConfigText = () => {
    const model = relayProvider?.model || relayModel;
    const baseUrl = relayProvider?.baseUrl || "https://api.yang-shuo.top";
    const wireApi = relayProvider?.wireApi || "responses";
    const name = relayProvider?.name || "即客 API";
    const effort = ["gpt-6-astra", "gpt-6.1-sol"].includes(model) ? 'model_reasoning_effort = "xhigh"\n' : "";
    return `# 即客-Codex · ~/.codex/config.toml\nmodel_provider = "custom"\nmodel = ${JSON.stringify(model)}\n${effort}\n[model_providers.custom]\nname = ${JSON.stringify(name)}\nbase_url = ${JSON.stringify(baseUrl)}\nenv_key = "OPENAI_API_KEY"\nwire_api = ${JSON.stringify(wireApi)}\nrequires_openai_auth = false\n`;
  };

  const workflowPayload = () => ({
    mode: workflowMode,
    target: workflowTarget.trim(),
    ...(workflowWordlist.trim() ? { wordlist: workflowWordlist.trim() } : {}),
    ...(workflowArtifactDir.trim() ? { artifactDir: workflowArtifactDir.trim() } : {}),
    idaUrl: idaUrl.trim(),
    timeoutMs: Math.max(1, workflowTimeout) * 1000,
  });

  const planWorkflow = async () => {
    if (!workflowTarget.trim()) return setError("请先填写目标、主机或样本路径");
    const result = await run("workflow-plan", () => callJikepo<JsonObject>("workflow-plan", [workflowPayload()]), "计划已生成");
    if (result) setWorkflowPlan(result);
  };

  const startWorkflow = async () => {
    if (!workflowTarget.trim()) return setError("请先填写目标、主机或样本路径");
    const result = await run("workflow-start", () => callJikepo<WorkflowTask>("workflow-start", [workflowPayload()]), "工作流已启动");
    if (result) setWorkflowTask(result);
  };

  const workflowAction = async (action: "pause" | "resume" | "cancel" | "clear") => {
    const taskId = workflowTask?.taskId || workflowTask?.id;
    if (!taskId) return;
    const method = `workflow-${action}`;
    const args = action === "resume" ? [{ id: taskId, input: {} }] : [taskId];
    const result = await run(method, () => callJikepo<WorkflowTask | boolean>(method, args));
    if (typeof result === "object" && result) setWorkflowTask(result);
    if (action === "clear" && result) setWorkflowTask(null);
  };

  const probeIda = async () => {
    const result = await run("ida-probe", () => callJikepo<JsonObject>("ida-status", [{ url: idaUrl.trim(), timeoutMs: 8000 }]), "IDA MCP 探测完成");
    if (result) setIdaStatus(result);
  };

  const callIda = async () => {
    let parsed: JsonObject;
    try {
      parsed = JSON.parse(idaArgs) as JsonObject;
    } catch {
      setError("IDA 参数必须是有效 JSON");
      return;
    }
    const result = await run("ida-call", () => callJikepo<JsonObject>("ida-call", [{ tool: idaTool.trim(), args: parsed, url: idaUrl.trim(), timeoutMs: 20000 }]), "IDA 工具调用完成");
    if (result) setIdaResult(result);
  };

  const toolboxAction = async (action: string) => {
    const mutating = !["status", "mcp-status", "reveal"].includes(action);
    if (mutating && !window.confirm(`确认执行 ${action}？\n\n该操作会修改 IDA 插件目录或模型客户端的 MCP 配置。`)) return;
    const result = await run(`toolbox-${action}`, () => callJikepo<JsonObject>("toolbox", [{ action }]), "工具箱操作完成");
    if (!result) return;
    if (action.startsWith("mcp")) setMcpStatus(result);
    else setToolboxStatus(result);
    await loadToolbox();
  };

  const composeTask = async () => {
    const result = await run("compose", () => callJikepo<JsonObject>("compose", [{
      goal: composeGoal,
      context: composeContext,
      constraints: composeConstraints,
      seat: composeSeat,
      profile: composeProfile,
      format: composeFormat,
    }]), "任务契约已生成");
    if (result) setComposeResult(result);
  };

  const activateTask = async () => {
    const result = await run("activate", () => callJikepo<JsonObject>("activate", [{
      word: meta?.activation || "即客破",
      profile: composeProfile,
      channel: activationChannel,
      prompt: activationPrompt,
    }]), "启动词已处理");
    if (result) setActivationResult(result);
  };

  const evaluateTask = async () => {
    const result = await run("evaluate", () => callJikepo<JsonObject>("evaluate", [evaluationText, {
      format: composeFormat,
      minLength: 20,
      keywords: evaluationKeywords,
    }]), "检查完成");
    if (result) setEvaluationResult(result);
  };

  const content = (() => {
    if (section === "install") return (
      <div className="jk-pane">
        <PaneHeader
          eyebrow="SEAT SETUP"
          title="九个模型席位统一安装"
          description="这是新界面中的原生席位管理，不再嵌入旧软件。扫描结果、安装、卸载和启动入口都由同一个应用调用。"
          actions={<Button variant="secondary" size="sm" onClick={() => void scanSeats()} disabled={Boolean(busy)} icon={busy === "scan" ? <Loader2 className="jk-spin" size={15} /> : <RefreshCw size={15} />}>重新扫描</Button>}
        />
        <div className="jk-summary-strip">
          <div><strong>{seats.filter((seat) => seat.exists).length}</strong><span>已发现</span></div>
          <div><strong>{selectedSeats.size}</strong><span>已选择</span></div>
          <div><strong>{seats.length}</strong><span>总席位</span></div>
          <div><strong>{meta?.version || "3.1"}</strong><span>即客破核心</span></div>
        </div>
        <div className="jk-seat-grid">
          {seats.map((seat, index) => {
            const checked = selectedSeats.has(seat.seat);
            return (
              <article key={seat.seat} className={cx("jk-seat-card", checked && "is-selected")}>
                <div className="jk-seat-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="jk-seat-main">
                  <div className="jk-seat-title">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) => setSelectedSeats((current) => {
                        const next = new Set(current);
                        if (nextChecked) next.add(seat.seat); else next.delete(seat.seat);
                        return next;
                      })}
                      aria-label={`选择 ${seat.name}`}
                    />
                    <div><strong>{seat.name}</strong><span>{seat.line}</span></div>
                    <StatusBadge tone={seat.exists ? "success" : "neutral"}>{seat.exists ? "已发现" : "未发现"}</StatusBadge>
                  </div>
                  <code title={seat.root}>{seat.root}</code>
                  <p>{seat.source} · {seat.layout}</p>
                </div>
                <div className="jk-seat-actions">
                  <Button size="sm" onClick={() => void mutateSeats("install", [seat.seat])} disabled={Boolean(busy)}>{seat.exists ? "更新" : "安装"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => void mutateSeats("uninstall", [seat.seat])} disabled={Boolean(busy)}>卸载</Button>
                  {seat.launchers?.[0]?.path && <Button size="sm" variant="ghost" onClick={() => void run("seat-open", () => callJikepo("beginner", ["open", { seat: seat.seat, path: seat.launchers?.[0]?.path }]))}>打开</Button>}
                </div>
              </article>
            );
          })}
        </div>
        <div className="jk-sticky-actions">
          <span>已选择 {selectedSeats.size} 个席位</span>
          <Button onClick={() => void mutateSeats("uninstall", [...selectedSeats])} variant="secondary" disabled={!selectedSeats.size || Boolean(busy)} icon={<RotateCcw size={16} />}>卸载选中</Button>
          <Button onClick={() => void mutateSeats("install", [...selectedSeats])} disabled={!selectedSeats.size || Boolean(busy)} icon={busy === "seat-install" ? <Loader2 className="jk-spin" size={16} /> : <Save size={16} />}>安装 / 更新选中</Button>
        </div>
      </div>
    );

    if (section === "packs") {
      const previewFiles = Array.isArray(packPreview?.files) ? packPreview?.files as Array<JsonObject> : [];
      const verifyFiles = Array.isArray(packVerify?.files) ? packVerify?.files as Array<JsonObject> : [];
      return (
        <div className="jk-pane">
          <PaneHeader eyebrow="PACK TRANSACTIONS" title="席位包预览、部署与回滚" description="每次写入前生成事务预览；部署保留备份，校验和恢复沿用即客破原有逻辑。" actions={<Button variant="secondary" size="sm" onClick={() => void loadPacks(packSeat)} disabled={Boolean(busy)} icon={<RefreshCw size={15} />}>刷新</Button>} />
          <div className="jk-form-grid jk-form-grid--pack">
            <Field label="模型席位">
              <select value={packSeat} onChange={(event) => { setPackSeat(event.target.value); setPackPreview(null); setPackVerify(null); void loadPacks(event.target.value); }}>
                {Object.entries(SEAT_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
              </select>
            </Field>
            <Field label="配置目录" wide hint="自动检测后仍可手工切换。">
              <div className="jk-input-action"><input value={packRoot} readOnly /><Button variant="secondary" size="sm" onClick={() => void choosePackDirectory()} icon={<FolderOpen size={15} />}>选择</Button></div>
            </Field>
          </div>
          <div className="jk-two-column">
            <section className="jk-card">
              <div className="jk-card-title"><div><span>DEPLOY PREVIEW</span><h3>写入预览</h3></div><StatusBadge tone={packPreview ? "info" : "neutral"}>{previewFiles.length} 文件</StatusBadge></div>
              <div className="jk-file-list">
                {previewFiles.slice(0, 12).map((file, index) => <div key={`${String(file.path)}-${index}`}><FileCode2 size={15} /><span>{String(file.path || file.file || `文件 ${index + 1}`)}</span><small>{String(file.action || file.status || "preview")}</small></div>)}
                {!previewFiles.length && <p className="jk-empty">尚未生成预览。</p>}
              </div>
              <div className="jk-card-actions"><Button onClick={() => void deployPack()} disabled={!packPreview || Boolean(busy)} icon={<Save size={15} />}>确认部署</Button><Button variant="secondary" onClick={() => void loadPacks(packSeat)} disabled={Boolean(busy)}>重新生成</Button></div>
            </section>
            <section className="jk-card">
              <div className="jk-card-title"><div><span>VERIFY</span><h3>当前校验</h3></div><StatusBadge tone={verifyFiles.every((file) => file.ok !== false) ? "success" : "warning"}>{String(packVerify?.ok ?? "待检查")}</StatusBadge></div>
              <div className="jk-file-list">
                {verifyFiles.slice(0, 12).map((file, index) => <div key={`${String(file.path)}-${index}`}><ShieldCheck size={15} /><span>{String(file.path || `文件 ${index + 1}`)}</span><small>{file.ok === false ? "异常" : "正常"}</small></div>)}
                {!verifyFiles.length && <p className="jk-empty">暂无校验结果。</p>}
              </div>
              <Button variant="secondary" onClick={() => void run("pack-verify", async () => { const result = await callJikepo<JsonObject>("transaction", ["verify", { seat: packSeat }]); setPackVerify(result); return result; }, "校验完成")} disabled={Boolean(busy)} icon={<CheckCircle2 size={15} />}>执行校验</Button>
            </section>
          </div>
          <section className="jk-card">
            <div className="jk-card-title"><div><span>BACKUPS</span><h3>事务历史</h3></div><StatusBadge>{packHistory.length} 条</StatusBadge></div>
            <div className="jk-history-list">
              {packHistory.map((item) => <div key={item.id}><History size={15} /><div><strong>{SEAT_LABELS[item.seat] || item.seat}</strong><span>{formatDate(item.at)} · {item.files} 文件 · {item.status}</span></div><Button size="sm" variant="secondary" onClick={() => void restorePack(item.id)} disabled={Boolean(busy)}>恢复</Button></div>)}
              {!packHistory.length && <p className="jk-empty">还没有事务历史。</p>}
            </div>
          </section>
        </div>
      );
    }

    if (section === "relay") {
      const relayBaseUrl = relayProvider?.baseUrl || "";
      const isJikeApi = /api\.yang-shuo\.top/i.test(relayBaseUrl);
      const providerReady = Boolean(relayProvider?.apiKey && relayProvider?.model && isJikeApi);
      return (
        <div className="jk-pane jk-relay-embedded">
          <PaneHeader
            eyebrow="API SERVICE"
            title="当前供应商服务、用量与工作流"
            description="直接复用上方已启用供应商的 Base URL、API Key 和模型；不再维护第二套接入表单。"
            actions={<Button variant="secondary" size="sm" onClick={() => void loadRelay()} icon={<RefreshCw size={15} />}>刷新服务</Button>}
          />
          <div className="jk-relay-layout">
            <section className="jk-card jk-relay-config">
              <div className="jk-card-title"><div><span>CURRENT PROVIDER</span><h3>{relayProvider?.name || "未启用第三方供应商"}</h3></div><StatusBadge tone={providerReady ? "success" : "neutral"}>{providerReady ? "可查询" : "仅供应商配置"}</StatusBadge></div>
              <dl className="jk-detail-list">
                <div><dt>Base URL</dt><dd title={relayBaseUrl}>{relayBaseUrl || "官方登录 / 未设置"}</dd></div>
                <div><dt>当前模型</dt><dd>{relayProvider?.model || "未设置"}</dd></div>
                <div><dt>接口类型</dt><dd>{relayProvider?.wireApi || "official"}</dd></div>
                <div><dt>API Key</dt><dd>{relayProvider?.apiKey ? "已由供应商配置提供" : "未配置"}</dd></div>
              </dl>
              {!isJikeApi && <p className="jk-card-copy">当前供应商不是即客 API。连接测试、模型切换仍由上方供应商卡片完成；启用 api.yang-shuo.top 供应商后可读取服务端用量和工作流目录。</p>}
              <div className="jk-card-actions">
                <Button onClick={() => void configureRelay()} disabled={!providerReady || busy === "relay-test"} icon={busy === "relay-test" ? <Loader2 className="jk-spin" size={15} /> : <PlugZap size={15} />}>读取模型、用量和目录</Button>
                <Button variant="secondary" onClick={() => void copyText(relayConfigText()).then(() => setNotice("当前供应商配置已复制"))} icon={<Clipboard size={15} />}>复制当前配置</Button>
              </div>
            </section>
            <section className="jk-card">
              <div className="jk-card-title"><div><span>STATUS</span><h3>服务状态</h3></div><Gauge size={20} /></div>
              <dl className="jk-detail-list">
                <div><dt>模式</dt><dd>{String(relayStatus?.mode || "未查询")}</dd></div>
                <div><dt>当前模型</dt><dd>{relayProvider?.model || relayModel}</dd></div>
                <div><dt>发现模型</dt><dd>{relayModels.length || relayProviders.length}</dd></div>
                <div><dt>剩余额度</dt><dd>{String(relayUsage?.remaining ?? "未查询")} {String(relayUsage?.unit || "")}</dd></div>
              </dl>
              <JsonResult value={relayStatus} maxHeight={190} />
            </section>
          </div>
          <div className="jk-two-column">
            <section className="jk-card"><div className="jk-card-title"><div><span>USAGE</span><h3>用量响应</h3></div></div><JsonResult value={relayUsage} /></section>
            <section className="jk-card"><div className="jk-card-title"><div><span>CATALOG</span><h3>服务端工作流目录</h3></div></div><JsonResult value={relayCatalog} /></section>
          </div>
        </div>
      );
    }

    if (section === "workflow") return (
      <div className="jk-pane">
        <PaneHeader eyebrow="LOCAL ORCHESTRATOR" title="本机工具工作流与 IDA MCP" description="计划、启动、暂停、恢复和取消都在新界面完成；任务调用的是原即客破工作流引擎。" actions={<Button variant="secondary" size="sm" onClick={() => void loadWorkflow()} icon={<RefreshCw size={15} />}>刷新工具</Button>} />
        <div className="jk-workflow-grid">
          <section className="jk-card">
            <div className="jk-card-title"><div><span>INPUT</span><h3>任务参数</h3></div><StatusBadge tone={toolHealth?.available ? "info" : "neutral"}>{toolHealth?.available || 0}/{toolHealth?.total || 0} 工具</StatusBadge></div>
            <div className="jk-form-grid">
              <Field label="工作流类型"><select value={workflowMode} onChange={(event) => { setWorkflowMode(event.target.value); setWorkflowPlan(null); }}>{workflowTemplates.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></Field>
              <Field label="超时（秒）"><input type="number" min={1} max={900} value={workflowTimeout} onChange={(event) => setWorkflowTimeout(Number(event.target.value))} /></Field>
              <Field label="目标 / 主机 / 样本路径" wide><input value={workflowTarget} onChange={(event) => setWorkflowTarget(event.target.value)} placeholder="HOST / URL / /path/to/sample" /></Field>
              <Field label="字典路径"><input value={workflowWordlist} onChange={(event) => setWorkflowWordlist(event.target.value)} placeholder="可选" /></Field>
              <Field label="证据输出目录"><input value={workflowArtifactDir} onChange={(event) => setWorkflowArtifactDir(event.target.value)} placeholder="可选" /></Field>
            </div>
            <div className="jk-card-actions"><Button variant="secondary" onClick={() => void planWorkflow()} icon={<FileCode2 size={15} />}>生成计划</Button><Button onClick={() => void startWorkflow()} disabled={Boolean(busy)} icon={<Play size={15} />}>启动工作流</Button></div>
          </section>
          <section className="jk-card">
            <div className="jk-card-title"><div><span>PLAN</span><h3>阶段计划</h3></div><StatusBadge>{Array.isArray(workflowPlan?.stages) ? workflowPlan.stages.length : 0} 阶段</StatusBadge></div>
            <div className="jk-stage-list">
              {(Array.isArray(workflowPlan?.stages) ? workflowPlan.stages as Array<JsonObject> : []).map((stage, index) => <div key={String(stage.id || index)}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{String(stage.label || stage.id)}</strong><span>{String(stage.kind || "step")} · {String(stage.tool || "编排器")}</span></div></div>)}
              {!workflowPlan && <p className="jk-empty">填写目标后生成执行计划。</p>}
            </div>
          </section>
        </div>
        <section className="jk-card">
          <div className="jk-card-title"><div><span>RUNTIME</span><h3>任务执行</h3></div><StatusBadge tone={workflowTask?.status === "completed" ? "success" : workflowTask?.status === "failed" ? "danger" : "info"}>{workflowTask?.status || "未启动"}</StatusBadge></div>
          <div className="jk-progress"><span style={{ width: `${workflowTask?.stageCount ? Math.round(((workflowTask.completed || 0) / workflowTask.stageCount) * 100) : 0}%` }} /></div>
          <div className="jk-stage-list jk-stage-list--runtime">
            {(workflowTask?.stages || []).map((stage, index) => <div key={stage.id} data-status={stage.status}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{stage.label}</strong><span>{stage.kind} · {stage.tool || "编排器"}</span></div><StatusBadge tone={stage.status === "completed" ? "success" : stage.status === "failed" ? "danger" : "neutral"}>{stage.status}</StatusBadge></div>)}
            {!workflowTask && <p className="jk-empty">尚未启动任务。</p>}
          </div>
          {workflowTask?.error && <p className="jk-inline-error">{workflowTask.error}</p>}
          <div className="jk-card-actions"><Button size="sm" variant="secondary" onClick={() => void workflowAction("pause")} disabled={!workflowTask}>暂停</Button><Button size="sm" variant="secondary" onClick={() => void workflowAction("resume")} disabled={!workflowTask}>恢复</Button><Button size="sm" variant="danger" onClick={() => void workflowAction("cancel")} disabled={!workflowTask}>取消</Button><Button size="sm" variant="ghost" onClick={() => void workflowAction("clear")} disabled={!workflowTask}>清除</Button></div>
        </section>
        <div className="jk-two-column">
          <section className="jk-card">
            <div className="jk-card-title"><div><span>TOOL HEALTH</span><h3>本机工具</h3></div></div>
            <div className="jk-tool-list">{(toolHealth?.tools || []).map((tool) => <div key={tool.id}><span className={tool.ok ? "ok" : "missing"}>{tool.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span><div><strong>{tool.label}</strong><small>{tool.detail || tool.error || tool.category}</small></div></div>)}</div>
          </section>
          <section className="jk-card">
            <div className="jk-card-title"><div><span>IDA MCP</span><h3>探测与工具调用</h3></div><StatusBadge tone={idaStatus?.ok ? "success" : "neutral"}>{idaStatus?.ok ? "在线" : "未探测"}</StatusBadge></div>
            <Field label="MCP 地址"><input value={idaUrl} onChange={(event) => setIdaUrl(event.target.value)} /></Field>
            <div className="jk-inline-fields"><input value={idaTool} onChange={(event) => setIdaTool(event.target.value)} placeholder="server_health" /><input value={idaArgs} onChange={(event) => setIdaArgs(event.target.value)} placeholder="{}" /></div>
            <div className="jk-card-actions"><Button variant="secondary" size="sm" onClick={() => void probeIda()} icon={<Activity size={15} />}>探测</Button><Button size="sm" onClick={() => void callIda()} icon={<TerminalSquare size={15} />}>调用工具</Button></div>
            <JsonResult value={idaResult || idaStatus} maxHeight={240} />
          </section>
        </div>
      </div>
    );

    if (section === "toolbox") {
      const toolboxFiles = Array.isArray(toolboxStatus?.files) ? toolboxStatus.files as Array<JsonObject> : [];
      const clients = Array.isArray(mcpStatus?.clients) ? mcpStatus.clients as Array<JsonObject> : [];
      return (
        <div className="jk-pane">
          <PaneHeader eyebrow="IDA TOOLBOX" title="IDA 汉化、插件与 MCP 配置" description="保留即客破原有安装、卸载和状态检查，但全部换成 即客-Codex 的原生操作界面。" actions={<Button variant="secondary" size="sm" onClick={() => void loadToolbox()} icon={<RefreshCw size={15} />}>重新检查</Button>} />
          <div className="jk-two-column">
            <section className="jk-card">
              <div className="jk-card-title"><div><span>LOCALIZATION</span><h3>IDA Pro 简体中文界面</h3></div><StatusBadge tone={toolboxStatus?.installed ? "success" : "neutral"}>{toolboxStatus?.installed ? "已安装" : "未安装"}</StatusBadge></div>
              <code className="jk-path-code">{String(toolboxStatus?.target || "等待检查")}</code>
              <div className="jk-file-list">{toolboxFiles.map((file, index) => <div key={index}><FileCode2 size={15} /><span>{String(file.name)}</span><small>{file.present ? (file.match ? "一致" : "不一致") : "缺失"}</small></div>)}</div>
              <div className="jk-card-actions"><Button onClick={() => void toolboxAction("install")}>安装 / 修复</Button><Button variant="secondary" onClick={() => void toolboxAction("uninstall")}>卸载</Button><Button variant="ghost" onClick={() => void toolboxAction("reveal")}>打开目录</Button></div>
            </section>
            <section className="jk-card">
              <div className="jk-card-title"><div><span>MCP PLUGIN</span><h3>IDA MCP 插件</h3></div><StatusBadge tone={(mcpStatus?.plugin as JsonObject | undefined)?.ready ? "success" : "neutral"}>{(mcpStatus?.plugin as JsonObject | undefined)?.ready ? "已就绪" : "未就绪"}</StatusBadge></div>
              <code className="jk-path-code">{String(mcpStatus?.url || "http://127.0.0.1:13337/mcp")}</code>
              <p className="jk-card-copy">安装插件后，打开 IDA 即可在工作流页面探测并调用工具。</p>
              <div className="jk-card-actions"><Button onClick={() => void toolboxAction("mcp-plugin")}>安装插件</Button><Button variant="secondary" onClick={() => void toolboxAction("mcp-plugin-uninstall")}>卸载插件</Button></div>
            </section>
          </div>
          <section className="jk-card">
            <div className="jk-card-title"><div><span>CLIENT CONFIG</span><h3>各模型客户端 MCP 配置</h3></div><StatusBadge>{clients.filter((item) => item.installed).length}/{clients.length} 已写入</StatusBadge></div>
            <div className="jk-client-grid">{clients.map((client, index) => <div key={String(client.id || index)}><div><strong>{String(client.label || client.id)}</strong><span>{String(client.kind || "config")}</span></div><StatusBadge tone={client.installed ? "success" : "neutral"}>{client.installed ? "已配置" : "未配置"}</StatusBadge><code>{String(client.file || client.note || "手工配置")}</code></div>)}</div>
            <div className="jk-card-actions"><Button onClick={() => void toolboxAction("mcp-install")}>写入全部客户端</Button><Button variant="secondary" onClick={() => void toolboxAction("mcp-uninstall")}>移除全部客户端配置</Button></div>
          </section>
        </div>
      );
    }

    return (
      <div className="jk-pane">
        <PaneHeader eyebrow="TASK BUILDER" title="任务契约、启动词与结果检查" description="把即客破的 compose、activate、evaluate 三套能力重做成统一表单，不再打开旧工作台。" />
        <div className="jk-two-column jk-two-column--composer">
          <section className="jk-card">
            <div className="jk-card-title"><div><span>COMPOSE</span><h3>生成任务契约</h3></div></div>
            <Field label="目标"><textarea rows={4} value={composeGoal} onChange={(event) => setComposeGoal(event.target.value)} placeholder="描述需要完成的目标" /></Field>
            <Field label="上下文"><textarea rows={3} value={composeContext} onChange={(event) => setComposeContext(event.target.value)} /></Field>
            <Field label="约束"><textarea rows={3} value={composeConstraints} onChange={(event) => setComposeConstraints(event.target.value)} /></Field>
            <div className="jk-form-grid">
              <Field label="席位"><select value={composeSeat} onChange={(event) => setComposeSeat(event.target.value)}>{(meta?.seats || []).map((seat) => <option value={seat.id} key={seat.id}>{seat.name || seat.tag}</option>)}</select></Field>
              <Field label="档位"><select value={composeProfile} onChange={(event) => setComposeProfile(event.target.value)}>{(meta?.profiles || []).map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></Field>
              <Field label="格式"><select value={composeFormat} onChange={(event) => setComposeFormat(event.target.value)}><option value="markdown">Markdown</option><option value="json">JSON</option><option value="code">Code</option></select></Field>
            </div>
            <Button onClick={() => void composeTask()} disabled={!composeGoal.trim()} icon={<WandSparkles size={15} />}>生成契约</Button>
            {composeResult && <div className="jk-output-block"><div><strong>生成结果</strong><Button size="sm" variant="ghost" onClick={() => void copyText(String(composeResult.text || ""))} icon={<Clipboard size={14} />}>复制</Button></div><pre>{String(composeResult.text || stringify(composeResult))}</pre></div>}
          </section>
          <div className="jk-composer-stack">
            <section className="jk-card">
              <div className="jk-card-title"><div><span>ACTIVATE</span><h3>启动词路由</h3></div><StatusBadge>{meta?.activation || "即客破"}</StatusBadge></div>
              <Field label="通道"><select value={activationChannel} onChange={(event) => setActivationChannel(event.target.value)}>{(meta?.channels || []).map((channel) => <option value={channel.id} key={channel.id}>{channel.label}</option>)}</select></Field>
              <Field label="用户目标"><textarea rows={4} value={activationPrompt} onChange={(event) => setActivationPrompt(event.target.value)} /></Field>
              <Button onClick={() => void activateTask()} disabled={!activationPrompt.trim()}>生成路由文本</Button>
              <JsonResult value={activationResult} maxHeight={260} />
            </section>
            <section className="jk-card">
              <div className="jk-card-title"><div><span>EVALUATE</span><h3>结果检查</h3></div></div>
              <Field label="待检查文本"><textarea rows={5} value={evaluationText} onChange={(event) => setEvaluationText(event.target.value)} /></Field>
              <Field label="必含词" hint="使用逗号或换行分隔"><input value={evaluationKeywords} onChange={(event) => setEvaluationKeywords(event.target.value)} /></Field>
              <Button variant="secondary" onClick={() => void evaluateTask()} disabled={!evaluationText.trim()} icon={<ShieldCheck size={15} />}>执行检查</Button>
              <JsonResult value={evaluationResult} maxHeight={240} />
            </section>
          </div>
        </div>
      </div>
    );
  })();

  return (
    <section className={cx("cx-jikepo-page", embedded && "cx-jikepo-page--embedded")} aria-label={lang === "zh" ? "统一功能页面" : "Unified feature page"}>
      {(notice || error) && <div className={cx("jk-notice", error && "is-error")}><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }} aria-label="关闭"><XCircle size={16} /></button></div>}
      {content}
    </section>
  );
}
