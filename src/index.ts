import "dotenv/config";
import path from "path";

// Windows 上 Claude Code 需要 git-bash
if (process.env["CLAUDE_CODE_GIT_BASH_PATH"]) {
  process.env["CLAUDE_CODE_GIT_BASH_PATH"] = process.env["CLAUDE_CODE_GIT_BASH_PATH"];
}
import { SessionManager } from "./runner/session.manager.js";
import { PermissionManager } from "./permissions/permission.manager.js";
import { ClaudeRunner } from "./runner/claude.runner.js";
import { MessageRouter } from "./router/message.router.js";
import { TelegramAdapter } from "./adapters/telegram.adapter.js";
import { DingTalkAdapter } from "./adapters/dingtalk.adapter.js";
import { loadProfile } from "./clawra/profile.js";
import { loadSchedule } from "./clawra/schedule.js";
import { ClawraScheduler } from "./clawra/scheduler.js";
import { ensureProfile } from "./clawra/setup.js";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`缺少必要环境变量: ${key}`);
  return val;
}

async function main() {
  // ── 首次运行：确保 Clawra 人设已配置 ─────────────────────────────────────
  const profilePath = path.resolve(process.cwd(), "config/clawra-profile.json");
  await ensureProfile(profilePath);

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
  const router = new MessageRouter(runner, permissions);

  // ── 适配器列表（供调度器使用）────────────────────────────────────────────
  const activeAdapters: Array<TelegramAdapter | InstanceType<typeof DingTalkAdapter>> = [];

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    const telegram = new TelegramAdapter(requireEnv("TELEGRAM_BOT_TOKEN"));
    router.registerAdapter(telegram);
    activeAdapters.push(telegram);
  }

  // ── 钉钉 ──────────────────────────────────────────────────────────────────
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

  if (router["adapters"].length === 0) {
    console.warn("未配置任何 IM 适配器，请检查 .env 文件");
    process.exit(1);
  }

  // ── Clawra 调度器 ─────────────────────────────────────────────────────────
  let scheduler: ClawraScheduler | null = null;

  const scheduleEnabled = process.env["CLAWRA_SCHEDULE_ENABLED"] === "true";
  if (scheduleEnabled) {
    const schedulePath = path.resolve(process.cwd(), "config/clawra-schedule.json");

    const profile = loadProfile(profilePath);
    const schedule = loadSchedule(schedulePath);

    const targetChatId =
      process.env["CLAWRA_TARGET_CHAT_ID"] ?? "8251974296";
    const timezone = process.env["CLAWRA_TIMEZONE"] ?? "Asia/Shanghai";

    scheduler = new ClawraScheduler({
      profile,
      schedule,
      adapters: activeAdapters,
      targetChatId,
      timezone,
    });
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

  // ── 启动调度器（先注册 cron，不阻塞）────────────────────────────────────
  if (scheduler) {
    scheduler.start();
    console.log("Clawra 主动消息调度已启动");
  }

  // ── 启动 IM 适配器（bot.start 长轮询，Promise 永不 resolve 直到停止）──
  console.log("IM-Claude Bridge 已启动");
  await router.startAll();
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
