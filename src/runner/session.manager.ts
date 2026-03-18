export interface Session {
  userId: string;
  /** SDK 返回的 session_id，用于 resume 续接对话 */
  sdkSessionId?: string;
  lastActiveAt: Date;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  getOrCreate(userId: string): Session {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, {
        userId,
        lastActiveAt: new Date(),
      });
    }
    return this.sessions.get(userId)!;
  }

  setSdkSessionId(userId: string, sessionId: string): void {
    const session = this.getOrCreate(userId);
    session.sdkSessionId = sessionId;
    session.lastActiveAt = new Date();
  }

  clear(userId: string): void {
    // 清空只是删除 sdkSessionId，下次会重新开一个会话
    const session = this.sessions.get(userId);
    if (session) {
      session.sdkSessionId = undefined;
      session.lastActiveAt = new Date();
    }
  }
}
