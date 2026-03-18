export interface PermissionConfig {
  /** 白名单用户 ID，空数组 = 允许所有人（仅开发用） */
  allowedUserIds: string[];
  /** Claude Code 可使用的工具列表 */
  allowedTools: string[];
  /** Claude Code 工作目录 */
  workingDir: string;
}

export class PermissionManager {
  constructor(private readonly config: PermissionConfig) {}

  isUserAllowed(userId: string): boolean {
    if (this.config.allowedUserIds.length === 0) return true;
    return this.config.allowedUserIds.includes(userId);
  }

  getAllowedTools(): string[] {
    return [...this.config.allowedTools];
  }

  getWorkingDir(): string {
    return this.config.workingDir;
  }
}
