import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SessionManager } from "./session.manager.js";
import type { PermissionManager } from "../permissions/permission.manager.js";
import { getPersona, buildSystemPrompt } from "../clawra/profile.js";

export class ClaudeRunner {
  constructor(
    private readonly sessions: SessionManager,
    private readonly permissions: PermissionManager,
  ) {}

  async run(userId: string, userMessage: string, personaName: string): Promise<string> {
    console.log(`[FLOW][Runner] ====== 开始处理 ======`);
    console.log(`[FLOW][Runner] userId=${userId}`);
    console.log(`[FLOW][Runner] personaName=${personaName}`);
    console.log(`[FLOW][Runner] fullMessage="${userMessage}"`);
    const msgPreview = userMessage.slice(0, 30);
    console.log(`[FLOW][Runner] preview="${msgPreview}"`);
    const session = this.sessions.getOrCreate(userId, personaName);
    const abortController = new AbortController();

    const profile = getPersona(personaName);
    const systemPrompt = buildSystemPrompt(profile);

    const q = query({
      prompt: userMessage,
      options: {
        abortController,
        maxTurns: 10,
        allowedTools: this.permissions.getAllowedTools(),
        cwd: this.permissions.getWorkingDir(),
        agent: personaName,
        agents: {
          [personaName]: {
            description: `${profile.name} - virtual persona`,
            prompt: systemPrompt,
            tools: this.permissions.getAllowedTools(),
          },
        },
        ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
      },
    });

    let finalText = "";
    let eventCount = { result: 0, assistant: 0, other: 0 };

    for await (const event of q) {
      const eventType = event.type as string;
      if (eventType === "result") eventCount.result++;
      else if (eventType === "assistant") eventCount.assistant++;
      else eventCount.other++;

      switch (event.type) {
        case "result":
          if (event.subtype === "success") {
            finalText = event.result;
            this.sessions.setSdkSessionId(userId, personaName, event.session_id);
            const replyPreview = finalText.slice(0, 40).replace(/\n/g, ' ');
            console.log(`[FLOW][Runner] 生成回复 #${eventCount.result} user=${userId} reply="${replyPreview}..."`);
          } else {
            const err = event as { errors?: string[] };
            throw new Error(err.errors?.join("; ") || "执行失败");
          }
          break;

        case "assistant":
          if (!event.error) {
            for (const block of event.message.content) {
              if (block.type === "text" && !finalText) {
                finalText = block.text;
                console.log(`[FLOW][Runner] 从assistant提取文本 #${eventCount.assistant} user=${userId}`);
              }
            }
          }
          break;
      }
    }
    console.log(`[FLOW][Runner] 事件统计 user=${userId} result=${eventCount.result} assistant=${eventCount.assistant} other=${eventCount.other}`);

    const result = finalText.trim() || "（无响应）";
    return result;
  }

  getReplyPrefix(personaName: string): string {
    return getPersona(personaName).replyPrefix;
  }

  getContentPrefix(personaName: string): string {
    return getPersona(personaName).contentPrefix;
  }

  clearSession(userId: string, personaName: string): void {
    this.sessions.clear(userId, personaName);
  }

  clearAllSessions(userId: string): void {
    this.sessions.clearAll(userId);
  }
}
