import { Bot, type Context } from "grammy";
import type { IMAdapter, IncomingMessage, OutgoingMessage, MessageHandler } from "./base.adapter.js";

/** Telegram 消息单条上限 */
const TG_MAX_LEN = 4000;

export class TelegramAdapter implements IMAdapter {
  readonly platform = "telegram" as const;
  private readonly bot: Bot;
  private handler?: MessageHandler;

  constructor(token: string) {
    this.bot = new Bot(token);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    // 普通文本消息
    this.bot.on("message:text", async (ctx: Context) => {
      if (!this.handler || !ctx.message?.text) return;
      await this.handler(this.toIncoming(ctx, ctx.message.text));
    });

    // /start 欢迎
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        "你好！我是 Claude 助手。\n/clear - 清空对话历史\n/help - 使用说明",
      );
    });

    // /clear 清空会话
    this.bot.command("clear", async (ctx) => {
      if (!this.handler) return;
      await this.handler(this.toIncoming(ctx, "__CLEAR_SESSION__"));
      await ctx.reply("✓ 对话历史已清空");
    });

    // /help
    this.bot.command("help", async (ctx) => {
      await ctx.reply(
        "直接发消息即可与 Claude 对话。\n\n" +
          "支持的命令：\n" +
          "/clear - 清空对话历史，开始新对话\n" +
          "/help - 显示此帮助",
      );
    });

    this.bot.catch((err) => {
      console.error("[Telegram] Error:", err.message);
    });
  }

  private toIncoming(ctx: Context, text: string): IncomingMessage {
    return {
      userId: String(ctx.from?.id ?? "unknown"),
      chatId: String(ctx.chat?.id ?? "unknown"),
      text,
      platform: "telegram",
      timestamp: new Date(),
    };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const chunks = this.splitText(msg.text);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(msg.chatId, chunk, {
        parse_mode: "Markdown",
      });
    }
  }

  async start(): Promise<void> {
    console.log("[Telegram] Starting bot...");
    await this.bot.start({ onStart: () => console.log("[Telegram] Bot ready") });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    console.log("[Telegram] Bot stopped");
  }

  private splitText(text: string): string[] {
    if (text.length <= TG_MAX_LEN) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += TG_MAX_LEN) {
      chunks.push(text.slice(i, i + TG_MAX_LEN));
    }
    return chunks;
  }
}
