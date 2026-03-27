export interface IncomingMessage {
  /** 平台用户唯一 ID（Telegram userId / 钉钉 staffId / 微信 wxid） */
  userId: string;
  /** 会话 ID（Telegram chatId / 钉钉 conversationId / 微信 wxid） */
  chatId: string;
  /** 消息内容 */
  text: string;
  platform: "telegram" | "dingtalk" | "wechat";
  timestamp: Date;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
  mediaUrl?: string;       // 图片 URL（可能经过代理），用于实际上传
  fallbackText?: string;   // 图片上传失败时发送的文字内容（含原始 URL）
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface IMAdapter {
  readonly platform: "telegram" | "dingtalk" | "wechat";
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  onMessage(handler: MessageHandler): void;
}
