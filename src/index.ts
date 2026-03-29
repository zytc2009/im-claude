import "dotenv/config";
import path from "path";

if (process.env["CLAUDE_CODE_GIT_BASH_PATH"]) {
  process.env["CLAUDE_CODE_GIT_BASH_PATH"] = process.env["CLAUDE_CODE_GIT_BASH_PATH"];
}

import { SessionManager } from "./runner/session.manager.js";
import { PermissionManager } from "./permissions/permission.manager.js";
import { ClaudeRunner } from "./runner/claude.runner.js";
import { MessageRouter } from "./router/message.router.js";
import { TelegramAdapter } from "./adapters/telegram.adapter.js";
import { DingTalkAdapter } from "./adapters/dingtalk.adapter.js";
import { WeChatAdapter } from "./adapters/wechat.adapter.js";
import { loadPersonasConfig, getPersonaNames } from "./clawra/profile.js";
import { loadSchedule } from "./clawra/schedule.js";
import { ClawraScheduler } from "./clawra/scheduler.js";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`缺少必要环境变量: ${key}`);
  return val;
}

async function main() {
  // ── 加载虚拟人配置 ────────────────────────────────────────────────────────
  const personasPath = path.resolve(process.cwd(), "config/personas.json");
  const personasConfig = loadPersonasConfig(personasPath);
  const personaNames = getPersonaNames();           // 小写名列表
  const defaultPersona = personasConfig.default.toLowerCase();

  console.log(`[Personas] 已加载 ${personaNames.length} 个虚拟人：${personaNames.join("、")}`);
  console.log(`[Personas] 默认：${defaultPersona}`);

  // ── 公共组件 ──────────────────────────────────────────────────────────────
  const sessions = new SessionManager();

  const permissions = new PermissionManager({
    allowedUserIds: (process.env["ALLOWED_USER_IDS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowedTools: (process.env["ALLOWED_TOOLS"] ?? "Read,Glob,Grep")
      .split(",")
      .map((s) => s.trim()),
    workingDir: process.env["WORKING_DIR"] ?? process.cwd(),
  });

  const runner = new ClaudeRunner(sessions, permissions);
  const router = new MessageRouter(runner, permissions, personaNames, defaultPersona);

  // ── 适配器 ────────────────────────────────────────────────────────────────
  const activeAdapters: Array<TelegramAdapter | InstanceType<typeof DingTalkAdapter> | WeChatAdapter> = [];

  if (process.env["TELEGRAM_ENABLED"] !== "false" && process.env["TELEGRAM_BOT_TOKEN"]) {
    const telegram = new TelegramAdapter(requireEnv("TELEGRAM_BOT_TOKEN"));
    router.registerAdapter(telegram);
    activeAdapters.push(telegram);
  }

  if (process.env["DINGTALK_APP_KEY"]) {
    const dingtalk = new DingTalkAdapter({
      appKey: requireEnv("DINGTALK_APP_KEY"),
      appSecret: requireEnv("DINGTALK_APP_SECRET"),
      agentId: requireEnv("DINGTALK_AGENT_ID"),
      webhookSecret: requireEnv("DINGTALK_WEBHOOK_SECRET"),
      port: Number(process.env["DINGTALK_WEBHOOK_PORT"] ?? "3000"),
    });
    router.registerAdapter(dingtalk);
    activeAdapters.push(dingtalk);
  }

  if (process.env["WECHAT_ENABLED"] === "true") {
    const wechat = new WeChatAdapter();
    router.registerAdapter(wechat);
    activeAdapters.push(wechat);
  }

  if (router["adapters"].length === 0) {
    console.warn("未配置任何 IM 适配器，请检查 .env 文件");
    process.exit(1);
  }

  // ── 调度器（可选）────────────────────────────────────────────────────────
  let scheduler: ClawraScheduler | null = null;

  const scheduleEnabled = process.env["CLAWRA_SCHEDULE_ENABLED"] === "true";
  if (scheduleEnabled) {
    const schedulePath = path.resolve(process.cwd(), "config/clawra-schedule.json");
    const schedule = loadSchedule(schedulePath);

    // 调度器使用默认 persona
    const { loadProfile } = await import("./clawra/profile.js");
    const profile = loadProfile("");   // legacy shim，返回默认 persona

    const targetChatId = process.env["CLAWRA_TARGET_CHAT_ID"] ?? "";
    const timezone = process.env["CLAWRA_TIMEZONE"] ?? "Asia/Shanghai";

    if (!targetChatId) {
      console.warn("⚠️  CLAWRA_SCHEDULE_ENABLED=true 但未设置 CLAWRA_TARGET_CHAT_ID，调度器已跳过");
    } else {
      scheduler = new ClawraScheduler({
        profile,
        schedule,
        adapters: activeAdapters,
        targetChatId,
        timezone,
      });
    }
  }

  // ── 优雅退出 ──────────────────────────────────────────────────────────────
  const shutdown = async () => {
    console.log("\n正在关闭...");
    if (scheduler) scheduler.stop();
    await router.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (scheduler) {
    scheduler.start();
    console.log("主动消息调度已启动");
  }

  console.log("IM-Claude Bridge 已启动");
  await router.startAll();
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
