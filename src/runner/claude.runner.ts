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

    for await (const event of q) {
      switch (event.type) {
        case "result":
          if (event.subtype === "success") {
            finalText = event.result;
            this.sessions.setSdkSessionId(userId, personaName, event.session_id);
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
              }
            }
          }
          break;
      }
    }

    return finalText.trim() || "（无响应）";
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
