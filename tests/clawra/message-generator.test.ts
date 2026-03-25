import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClawraProfile, ScheduleEntry } from "../../src/clawra/types.js";

// Mock @anthropic-ai/sdk before importing the module under test
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

// Mock profile module to avoid FS operations
vi.mock("../../src/clawra/profile.js", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("mocked system prompt"),
}));

import { generateMessage } from "../../src/clawra/message-generator.js";

const mockProfile: ClawraProfile = {
  name: "Clawra",
  gender: "female",
  personality: ["温柔"],
  hobbies: ["咖啡"],
  speakingStyle: "简短",
  referenceImageUrl: "https://example.com/img.png",
  language: "zh-CN",
};

const mockEntry: ScheduleEntry = {
  time: "07:15",
  activity: "起床",
  location: "bedroom",
  sendPhoto: true,
  messageType: "greeting",
  promptHint: "刚起床",
};

async function getAnthropicMock() {
  const mod = await import("@anthropic-ai/sdk");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).__mockCreate as ReturnType<typeof vi.fn>;
}

describe("generateMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should return LLM response on success", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "早安呀~ 起床啦！" }],
    });

    const promise = generateMessage(mockProfile, mockEntry);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("早安呀~ 起床啦！");
  });

  it("should retry on failure and succeed on second attempt", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "重试成功" }],
      });

    const promise = generateMessage(mockProfile, mockEntry);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("重试成功");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("should return fallback template when all retries fail", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate.mockRejectedValue(new Error("Always fails"));

    const promise = generateMessage(mockProfile, mockEntry);
    await vi.runAllTimersAsync();
    const result = await promise;

    const greetingFallbacks = [
      "早安~ 今天也要加油哦！",
      "起床啦，新的一天开始了~",
      "早上好呀，昨晚睡得好吗？",
    ];
    expect(greetingFallbacks).toContain(result);
  });

  it("should use goodnight fallback for goodnight messageType", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate.mockRejectedValue(new Error("Always fails"));

    const goodnightEntry: ScheduleEntry = {
      ...mockEntry,
      messageType: "goodnight",
    };

    const promise = generateMessage(mockProfile, goodnightEntry);
    await vi.runAllTimersAsync();
    const result = await promise;

    const goodnightFallbacks = [
      "要睡觉了，晚安~",
      "好困哦，先去睡了，晚安",
      "睡了哦，做个好梦~",
    ];
    expect(goodnightFallbacks).toContain(result);
  });

  it("should use meal fallback for meal messageType", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate.mockRejectedValue(new Error("Always fails"));

    const mealEntry: ScheduleEntry = {
      ...mockEntry,
      messageType: "meal",
    };

    const promise = generateMessage(mockProfile, mealEntry);
    await vi.runAllTimersAsync();
    const result = await promise;

    const mealFallbacks = [
      "该吃饭啦，别忘了~",
      "吃饭时间到了，好好吃饭哦",
      "记得吃饭呀，身体最重要",
    ];
    expect(mealFallbacks).toContain(result);
  });

  it("should return fallback when LLM returns no text block", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate.mockResolvedValue({ content: [] });

    const promise = generateMessage(mockProfile, mockEntry);
    await vi.runAllTimersAsync();
    const result = await promise;

    // Should fall back after exhausting retries
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should accept optional context parameter", async () => {
    const mockCreate = await getAnthropicMock();
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "有context的回复" }],
    });

    const promise = generateMessage(mockProfile, mockEntry, "今天天气很好");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("有context的回复");
  });
});
