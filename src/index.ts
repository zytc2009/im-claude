import "dotenv/config";

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

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`缺少必要环境变量: ${key}`);
  return val;
}

async function main() {
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

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    const telegram = new TelegramAdapter(requireEnv("TELEGRAM_BOT_TOKEN"));
    router.registerAdapter(telegram);
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
  }

  if (router["adapters"].length === 0) {
    console.warn("⚠️  未配置任何 IM 适配器，请检查 .env 文件");
    process.exit(1);
  }

  // ── 优雅退出 ──────────────────────────────────────────────────────────────
  const shutdown = async () => {
    console.log("\n正在关闭...");
    await router.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await router.startAll();
  console.log("🚀 IM-Claude Bridge 已启动");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
