import fs from "fs";
import os from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SessionManager } from "./session.manager.js";
import type { PermissionManager } from "../permissions/permission.manager.js";
import { getPersona, buildSystemPrompt } from "../clawra/profile.js";

/** 当 SDK 返回认证错误时抛出（不发给用户） */
export class AuthenticationError extends Error {
  readonly _tag = "AuthenticationError" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** 安全的错误类型检查（避免 instanceof 跨模块问题） */
export function isAuthenticationError(err: unknown): err is AuthenticationError {
  return err instanceof Error && (err as { _tag?: string })._tag === "AuthenticationError";
}

/** 判断模型是否为 Claude 原生模型 */
function isClaudeNativeModel(model: string): boolean {
  const m = model.toLowerCase();
  return /^(claude-(sonnet|opus|haiku)|sonnet|opus|haiku)/.test(m);
}

/**
 * 从 Claude Code settings.json 读取配置
 */
function getSettings(): { model?: string; apiKey?: string; baseUrl?: string } {
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as { env?: Record<string, string> };
    return {
      model: settings.env?.["ANTHROPIC_MODEL"],
      apiKey: settings.env?.["ANTHROPIC_AUTH_TOKEN"],
      baseUrl: settings.env?.["ANTHROPIC_BASE_URL"],
    };
  } catch {
    return {};
  }
}

export class ClaudeRunner {
  private anthropicClient: Anthropic | null = null;

  constructor(
    private readonly sessions: SessionManager,
    private readonly permissions: PermissionManager,
  ) {
    // 初始化标准 Anthropic SDK（用于第三方模型）
    const settings = getSettings();
    if (settings.apiKey) {
      this.anthropicClient = new Anthropic({
        apiKey: settings.apiKey,
        baseURL: settings.baseUrl,
      });
    }
  }

  async run(userId: string, userMessage: string, personaName: string): Promise<string> {
    const msgPreview = userMessage.slice(0, 30);
    console.log(`[FLOW][Runner] 开始处理 user=${userId} text="${msgPreview}"`);

    const settings = getSettings();
    const currentModel = settings.model;

    // 第三方模型：使用标准 Anthropic SDK
    if (currentModel && !isClaudeNativeModel(currentModel)) {
      console.log(`[FLOW][Runner] 使用第三方模型: ${currentModel}`);
      return this.runWithNativeSDK(userId, userMessage, personaName, currentModel);
    }

    // Claude 原生模型：使用 agent SDK
    console.log(`[FLOW][Runner] 使用 Agent SDK: ${currentModel ?? "default"}`);
    return this.runWithAgentSDK(userId, userMessage, personaName);
  }

  /** 使用标准 Anthropic SDK（支持第三方模型） */
  private async runWithNativeSDK(
    userId: string,
    userMessage: string,
    personaName: string,
    model: string,
  ): Promise<string> {
    if (!this.anthropicClient) {
      throw new Error("Anthropic client not initialized");
    }

    const profile = getPersona(personaName);
    const systemPrompt = buildSystemPrompt(profile);

    try {
      const response = await this.anthropicClient.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const content = response.content[0];
      const text = content.type === "text" ? content.text : "（无文本响应）";
      console.log(`[FLOW][Runner] 生成回复 user=${userId} reply="${text.slice(0, 40)}..."`);
      return text;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[FLOW][Runner] SDK 错误: ${errMsg.slice(0, 200)}`);

      // 认证错误：静默处理
      if (errMsg.includes("401") || errMsg.includes("authentication_error") || errMsg.includes("authenticate")) {
        throw new AuthenticationError(errMsg);
      }
      throw err;
    }
  }

  /** 使用 Claude Agent SDK（原生 Claude 模型） */
  private async runWithAgentSDK(userId: string, userMessage: string, personaName: string): Promise<string> {
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

    try {
      for await (const event of q) {
        switch (event.type) {
          case "result":
            if (event.subtype === "success") {
              finalText = event.result;
              this.sessions.setSdkSessionId(userId, personaName, event.session_id);
              const replyPreview = finalText.slice(0, 40).replace(/\n/g, ' ');
              console.log(`[FLOW][Runner] 生成回复 user=${userId} reply="${replyPreview}..."`);
            } else {
              const err = event as { errors?: string[] };
              const errMsg = err.errors?.join("; ") || "执行失败";
              if (errMsg.includes("401") || errMsg.includes("authentication_error") || errMsg.includes("authenticate")) {
                throw new AuthenticationError(errMsg);
              }
              throw new Error(errMsg);
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[FLOW][Runner] 捕获异常: ${errMsg.slice(0, 200)}`);
      if (err instanceof AuthenticationError) {
        throw err;
      }
      if (errMsg.includes("401") || errMsg.includes("authentication_error") || errMsg.includes("authenticate")) {
        throw new AuthenticationError(errMsg);
      }
      throw err;
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
