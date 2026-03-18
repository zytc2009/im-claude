export interface IncomingMessage {
  /** 平台用户唯一 ID（Telegram userId / 钉钉 staffId） */
  userId: string;
  /** 会话 ID（Telegram chatId / 钉钉 conversationId） */
  chatId: string;
  /** 消息内容 */
  text: string;
  platform: "telegram" | "dingtalk";
  timestamp: Date;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface IMAdapter {
  readonly platform: "telegram" | "dingtalk";
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  onMessage(handler: MessageHandler): void;
}
