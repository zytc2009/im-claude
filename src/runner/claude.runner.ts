import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SessionManager } from "./session.manager.js";
import type { PermissionManager } from "../permissions/permission.manager.js";
import { loadProfile, buildSystemPrompt } from "../clawra/profile.js";

export class ClaudeRunner {
  constructor(
    private readonly sessions: SessionManager,
    private readonly permissions: PermissionManager,
  ) {}

  async run(userId: string, userMessage: string): Promise<string> {
    const session = this.sessions.getOrCreate(userId);
    const abortController = new AbortController();

    const profilePath = path.resolve(process.cwd(), "config/clawra-profile.json");
    const profile = loadProfile(profilePath);
    const CLAWRA_PROMPT = buildSystemPrompt(profile);

    const q = query({
      prompt: userMessage,
      options: {
        abortController,
        maxTurns: 10,
        // 工具白名单
        allowedTools: this.permissions.getAllowedTools(),
        cwd: this.permissions.getWorkingDir(),
        // 注入 Clawra 人设和自拍能力
        agent: "clawra",
        agents: {
          clawra: {
            description: "Clawra - AI girlfriend with selfie capabilities",
            prompt: CLAWRA_PROMPT,
            tools: this.permissions.getAllowedTools(),
          },
        },
        // 有 sdkSessionId 则续接上次对话，否则开新会话
        ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
      },
    });

    let finalText = "";

    for await (const event of q) {
      switch (event.type) {
        case "result":
          if (event.subtype === "success") {
            // result 字段是对话的最终文本摘要
            finalText = event.result;
            // 保存 session_id 供下次续接
            this.sessions.setSdkSessionId(userId, event.session_id);
          } else {
            // 执行出错
            const err = event as { errors?: string[] };
            throw new Error(err.errors?.join("; ") ?? "执行失败");
          }
          break;

        case "assistant":
          // 逐步收集 assistant 文本（result 里也有，但这里可做流式转发）
          if (!event.error) {
            for (const block of event.message.content) {
              if (block.type === "text" && !finalText) {
                // 只在 result 未到达时用 assistant 事件兜底
                finalText = block.text;
              }
            }
          }
          break;
      }
    }

    return finalText.trim() || "（无响应）";
  }

  clearSession(userId: string): void {
    this.sessions.clear(userId);
  }
}
