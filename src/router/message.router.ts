import type { IMAdapter, IncomingMessage } from "../adapters/base.adapter.js";
import type { ClaudeRunner } from "../runner/claude.runner.js";
import type { PermissionManager } from "../permissions/permission.manager.js";

/** 正在处理中的用户集合，防止重复提交 */
const PROCESSING = new Set<string>();

export class MessageRouter {
  private readonly adapters: IMAdapter[] = [];

  constructor(
    private readonly runner: ClaudeRunner,
    private readonly permissions: PermissionManager,
  ) {}

  registerAdapter(adapter: IMAdapter): void {
    this.adapters.push(adapter);
    adapter.onMessage((msg) => this.handle(adapter, msg));
    console.log(`[Router] Registered adapter: ${adapter.platform}`);
  }

  private async handle(adapter: IMAdapter, msg: IncomingMessage): Promise<void> {
    // 权限校验
    if (!this.permissions.isUserAllowed(msg.userId)) {
      await adapter.sendMessage({ chatId: msg.chatId, text: "❌ 无访问权限" });
      return;
    }

    // /clear 指令
    if (msg.text === "__CLEAR_SESSION__") {
      this.runner.clearSession(msg.userId);
      return;
    }

    // 防并发：同一用户上一条还未处理完时，拒绝新请求
    if (PROCESSING.has(msg.userId)) {
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: "⏳ 上一条消息仍在处理中，请稍候...",
      });
      return;
    }

    PROCESSING.add(msg.userId);
    try {
      await adapter.sendMessage({ chatId: msg.chatId, text: "⏳ 思考中..." });
      const response = await this.runner.run(msg.userId, msg.text);
      await adapter.sendMessage({ chatId: msg.chatId, text: response });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[Router] Error for user ${msg.userId}:`, detail);
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: `❌ 出错了：${detail}`,
      });
    } finally {
      PROCESSING.delete(msg.userId);
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.stop()));
  }
}
