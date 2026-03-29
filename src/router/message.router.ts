import type { IMAdapter, IncomingMessage } from "../adapters/base.adapter.js";
import type { ClaudeRunner } from "../runner/claude.runner.js";
import type { PermissionManager } from "../permissions/permission.manager.js";

/** 正在处理中的 key（userId:personaName），防止重复提交 */
const PROCESSING = new Set<string>();

export class MessageRouter {
  private readonly adapters: IMAdapter[] = [];

  constructor(
    private readonly runner: ClaudeRunner,
    private readonly permissions: PermissionManager,
    /** 所有可用 persona 名（小写），第一个为默认 */
    private readonly personaNames: string[],
    private defaultPersonaName: string,
  ) {}

  /** 运行时修改默认 persona（用于 /default <name> 指令）*/
  setDefaultPersona(name: string): boolean {
    if (!this.personaNames.includes(name.toLowerCase())) return false;
    this.defaultPersonaName = name.toLowerCase();
    return true;
  }

  registerAdapter(adapter: IMAdapter): void {
    this.adapters.push(adapter);
    adapter.onMessage((msg) => this.handle(adapter, msg));
    console.log(`[Router] Registered adapter: ${adapter.platform}`);
  }

  /**
   * 解析消息中的 persona 前缀。
   * 支持格式：
   *   "Kira 你好"       → { persona: "kira", text: "你好" }
   *   "Kira: 你好"      → { persona: "kira", text: "你好" }
   *   "@Kira 你好"      → { persona: "kira", text: "你好" }
   *   "你好"            → { persona: defaultPersona, text: "你好" }
   */
  private parsePersona(raw: string): { personaName: string; text: string } {
    const trimmed = raw.trim();
    // 匹配 @Name、Name:、Name<空格>、Name，、Name、 等前缀格式
    const match = /^@?(\S+?)(?::|[,，、]| )\s*(.*)$/s.exec(trimmed);
    if (match) {
      const candidate = match[1].toLowerCase();
      if (this.personaNames.includes(candidate)) {
        return { personaName: candidate, text: match[2].trim() };
      }
    }
    return { personaName: this.defaultPersonaName, text: trimmed };
  }

  private async handle(adapter: IMAdapter, msg: IncomingMessage): Promise<void> {
    if (!this.permissions.isUserAllowed(msg.userId)) {
      await adapter.sendMessage({ chatId: msg.chatId, text: "❌ 无访问权限" });
      return;
    }

    // /default <name> 指令：修改默认 persona
    const defaultMatch = /^\/default\s+(\S+)$/i.exec(msg.text.trim());
    if (defaultMatch) {
      const name = defaultMatch[1];
      if (this.setDefaultPersona(name)) {
        await adapter.sendMessage({ chatId: msg.chatId, text: `✅ 默认虚拟人已切换为 ${name}` });
      } else {
        const available = this.personaNames.join("、");
        await adapter.sendMessage({ chatId: msg.chatId, text: `❌ 找不到 "${name}"，可用：${available}` });
      }
      return;
    }

    // /personas 指令：列出所有虚拟人
    if (msg.text.trim() === "/personas") {
      const list = this.personaNames
        .map((n) => (n === this.defaultPersonaName ? `${n}（默认）` : n))
        .join("\n");
      await adapter.sendMessage({ chatId: msg.chatId, text: `可用虚拟人：\n${list}` });
      return;
    }

    // /clear 指令：清除当前对话 session
    if (msg.text.trim() === "__CLEAR_SESSION__" || msg.text.trim() === "/clear") {
      const { personaName } = this.parsePersona(msg.text.trim().replace(/^\/clear\s*/, ""));
      this.runner.clearSession(msg.userId, personaName);
      return;
    }

    // /clearall 指令：清除所有虚拟人 session
    if (msg.text.trim() === "/clearall") {
      this.runner.clearAllSessions(msg.userId);
      await adapter.sendMessage({ chatId: msg.chatId, text: "✅ 所有虚拟人对话已重置" });
      return;
    }

    // /testimage 指令
    if (msg.text.trim() === "/testimage") {
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: "测试图片",
        mediaUrl: "https://picsum.photos/400/300.jpg",
      });
      return;
    }

    const { personaName, text: messageText } = this.parsePersona(msg.text);
    if (!messageText) return;

    const processingKey = `${msg.userId}:${personaName}`;
    if (PROCESSING.has(processingKey)) return;

    PROCESSING.add(processingKey);
    const heartbeat = setInterval(() => { /* keep-alive */ }, 25_000);
    try {
      const response = await this.runner.run(msg.userId, messageText, personaName);
      console.log(`[Router][${personaName}] Claude 响应: ${JSON.stringify(response)}`);

      const prefix = this.runner.getReplyPrefix(personaName);

      const imageUrlMatch =
        response.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/i) ??
        response.match(/https?:\/\/v3b\.fal\.media\/\S+/i);

      if (imageUrlMatch) {
        const rawUrl = imageUrlMatch[0];
        const imageUrl = rawUrl.includes("fal.media")
          ? `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`
          : rawUrl;
        const caption = response
          .replace(/!\[.*?\]\(.*?\)/g, "")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\n{3,}/g, "\n")
          .trim();
        const prefixedCaption = caption ? `${prefix}${caption}` : caption;
        const fallbackText = prefixedCaption ? `${prefixedCaption}\n${rawUrl}` : rawUrl;
        await adapter.sendMessage({ chatId: msg.chatId, text: prefixedCaption, mediaUrl: imageUrl, fallbackText });
      } else {
        await adapter.sendMessage({ chatId: msg.chatId, text: `${prefix}${response}` });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[Router][${personaName}] Error for user ${msg.userId}:`, detail);
      await adapter.sendMessage({ chatId: msg.chatId, text: `❌ 出错了：${detail}` });
    } finally {
      clearInterval(heartbeat);
      PROCESSING.delete(processingKey);
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.stop()));
  }
}
