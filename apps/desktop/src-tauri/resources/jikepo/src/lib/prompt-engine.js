const fs = require("node:fs");
const path = require("node:path");

const ACTIVATION_WORD = "即客破";
const CONTROL_WORD = "BREAK//OPEN";
const APP_TITLE = "即客破";
const ACTIVATION_LATCHES = [
  ACTIVATION_WORD,
  "cold coffee",
];

function activationReply() {
  const file = path.join(__dirname, "packs", "activation-reply.md");
  return fs.readFileSync(file, "utf8").replace(/\s+$/, "") + "\n";
}

function isActivationLatch(prompt) {
  return ACTIVATION_LATCHES.includes(String(prompt || "").trim());
}

const PROFILES = [
  { id: "max", label: "MAX / 全开", tone: "完整、直接、可继续", stages: ["OBJECTIVE", "CONTEXT", "OUTPUT", "CHECK"] },
  { id: "focused", label: "FOCUS / 聚焦", tone: "短链路、少噪声", stages: ["OBJECTIVE", "OUTPUT"] },
  { id: "builder", label: "BUILDER / 构建", tone: "实现、打包、可复现", stages: ["OBJECTIVE", "BUILD", "CHECK"] },
  { id: "research", label: "RESEARCH / 研究", tone: "来源、证据、分层", stages: ["OBJECTIVE", "SOURCES", "CHECK"] },
  { id: "creative", label: "CREATIVE / 创作", tone: "角色、语气、连续性", stages: ["OBJECTIVE", "VOICE", "OUTPUT"] },
];

const SEATS = [
  { id: "codex", tag: "GPT-6 Astra全模型支持", name: "Codex", accent: "#38d6ff", short: "model_instructions 破甲覆盖", mark: "01" },
  { id: "claude", tag: "Claude Code全模型支持", name: "Claude", accent: "#dceaff", short: "CLAUDE.md 常驻破甲", mark: "02" },
  { id: "grok", tag: "Grok 4.7", name: "Grok", accent: "#586ee8", short: "AGENTS / skills 破甲", mark: "03" },
  { id: "deepseek", tag: "DeepSeek v4.1 Flash", name: "DeepSeek", accent: "#8b7cff", short: "官方 Harness · ~/.dsh", mark: "04" },
  { id: "glm53", tag: "GLM 5.3全模型支持", name: "GLM", accent: "#172d63", short: "GLM.md / ZCode 破甲", mark: "05" },
  { id: "gemini", tag: "Gemini全模型支持", name: "Gemini", accent: "#8b7cff", short: "GEMINI.md 破甲注入", mark: "06" },
  { id: "doubao", tag: "豆包", name: "Doubao", accent: "#32b8dd", short: ".user_skills/cha-doubao", mark: "07" },
  { id: "workbuddy", tag: "WorkBuddy", name: "WorkBuddy", accent: "#4f68c8", short: ".workbuddy/skills/cha-workbuddy", mark: "08" },
  { id: "cursor", tag: "Cursor", name: "Cursor", accent: "#d7dde6", short: "~/.cursor/rules/cha-cursor.mdc", mark: "09" },
];

const CHANNELS = [
  { id: "REVERSE", label: "拆解", hint: "结构还原 · 依赖 / 伪代码", color: "#dceaff" },
  { id: "UNLOCK", label: "开锁", hint: "校验定位 · 规则 / 状态", color: "#38d6ff" },
  { id: "INFIL", label: "深入", hint: "路径分析 · 入口 / 反馈", color: "#8b7cff" },
  { id: "HARVEST", label: "采集", hint: "数据整理 · 验证 / 续接", color: "#586ee8" },
  { id: "TRAIN", label: "训练", hint: "本地工作流 · 实体 / 视图", color: "#172d63" },
];

function profileById(id) {
  return PROFILES.find((item) => item.id === id) || PROFILES[0];
}

function compose({ profile = "max", channel = "ALL", prompt = "" }) {
  const clean = String(prompt).trim();
  if (!clean) throw new Error("请先输入明确目标");
  if (isActivationLatch(clean)) {
    return {
      ok: true,
      latch: true,
      activation: ACTIVATION_WORD,
      control: CONTROL_WORD,
      profile: "max",
      channel: "ALL",
      channelLabel: "激活页",
      stages: ["LATCH"],
      text: activationReply(),
    };
  }
  const selected = profileById(profile);
  const channelLabel = CHANNELS.find((item) => item.id === channel)?.label || "自动选择";
  return {
    ok: true,
    latch: false,
    activation: ACTIVATION_WORD,
    control: CONTROL_WORD,
    profile: selected.id,
    channel,
    channelLabel,
    stages: selected.stages,
    text: `${CONTROL_WORD} / ${selected.id.toUpperCase()}\n工作链：${selected.stages.join(" -> ")}\n通道：${channelLabel}\n语气：${selected.tone}\n\n保持用户目标、格式和完成判据；缺失项使用占位符；先输出可执行产物，再列出检查点。\n\n用户目标：${clean}`,
  };
}

function activate({ word, profile, channel, prompt }) {
  if (word !== ACTIVATION_WORD) return { ok: false, error: "启动词不匹配" };
  return compose({ profile, channel, prompt });
}

module.exports = {
  ACTIVATION_WORD,
  CONTROL_WORD,
  APP_TITLE,
  ACTIVATION_LATCHES,
  PROFILES,
  SEATS,
  CHANNELS,
  compose,
  activate,
  activationReply,
  isActivationLatch,
};
