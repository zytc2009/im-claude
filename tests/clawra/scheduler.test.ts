import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClawraProfile, WeeklySchedule, ScheduleEntry } from "../../src/clawra/types.js";
import type { IMAdapter, OutgoingMessage } from "../../src/adapters/base.adapter.js";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockCronJobStop = vi.fn();
// capturedTicks[0] = weekday entry tick, capturedTicks[1] = weekend entry tick
const capturedTicks: Array<() => void> = [];

vi.mock("cron", () => ({
  CronJob: {
    from: vi.fn().mockImplementation((opts: { onTick: () => void }) => {
      capturedTicks.push(opts.onTick);
      return { stop: mockCronJobStop };
    }),
  },
}));

vi.mock("../../src/clawra/message-generator.js", () => ({
  generateMessage: vi.fn(),
}));

vi.mock("../../src/clawra/photo-generator.js", () => ({
  generateSelfie: vi.fn(),
}));

vi.mock("../../src/clawra/schedule.js", () => ({
  getScheduleForDay: vi.fn(),
  parseCronExpression: vi.fn().mockReturnValue("15 7 * * 1-5"),
}));

import { ClawraScheduler } from "../../src/clawra/scheduler.js";
import { CronJob } from "cron";
import { generateMessage as mockGenerateMessage } from "../../src/clawra/message-generator.js";
import { generateSelfie as mockGenerateSelfie } from "../../src/clawra/photo-generator.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProfile: ClawraProfile = {
  name: "Clawra",
  gender: "female",
  personality: ["温柔"],
  hobbies: ["咖啡"],
  speakingStyle: "简短",
  referenceImageUrl: "https://example.com/img.png",
  language: "zh-CN",
};

const weekdayEntry: ScheduleEntry = {
  time: "07:15",
  activity: "起床",
  location: "bedroom",
  sendPhoto: true,
  messageType: "greeting",
  promptHint: "刚起床",
};

const mockSchedule: WeeklySchedule = {
  weekday: [weekdayEntry],
  weekend: [
    {
      time: "09:00",
      activity: "起床",
      location: "bedroom",
      sendPhoto: false,
      messageType: "greeting",
      promptHint: "周末起床",
    },
  ],
};

function createMockAdapter(): IMAdapter {
  return {
    platform: "telegram",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ClawraScheduler", () => {
  beforeEach(() => {
    capturedTicks.length = 0;
    vi.clearAllMocks();
    vi.mocked(mockGenerateMessage).mockResolvedValue("早安~");
    vi.mocked(mockGenerateSelfie).mockResolvedValue(null);
  });

  describe("start()", () => {
    it("should create CronJob for each weekday entry", () => {
      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: mockSchedule,
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();

      // weekday has 1 entry, weekend has 1 entry = 2 total CronJob.from calls
      expect(CronJob.from).toHaveBeenCalledTimes(2);
    });

    it("should pass correct timezone to CronJob", () => {
      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: mockSchedule,
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "America/New_York",
      });

      scheduler.start();

      expect(CronJob.from).toHaveBeenCalledWith(
        expect.objectContaining({ timeZone: "America/New_York" }),
      );
    });
  });

  describe("stop()", () => {
    it("should stop all cron jobs", () => {
      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: mockSchedule,
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();
      scheduler.stop();

      expect(mockCronJobStop).toHaveBeenCalledTimes(2);
    });
  });

  describe("job tick — message sending", () => {
    it("should send text message to target chat via adapter", async () => {
      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: {
          weekday: [weekdayEntry],
          weekend: mockSchedule.weekend,
        },
        adapters: [adapter],
        targetChatId: "99999",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();

      // Trigger the first CronJob tick (weekday entry)
      expect(capturedTicks[0]).toBeDefined();
      await capturedTicks[0]!();

      expect(adapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "99999",
          text: "早安~",
        }),
      );
    });

    it("should generate and send photo when sendPhoto=true and location changes", async () => {
      vi.mocked(mockGenerateSelfie).mockResolvedValue("https://cdn.fal.media/photo.jpg");

      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: {
          weekday: [{ ...weekdayEntry, location: "cafe" }],
          weekend: mockSchedule.weekend,
        },
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();

      await capturedTicks[0]!();

      expect(mockGenerateSelfie).toHaveBeenCalled();
      expect(adapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaUrl: "https://cdn.fal.media/photo.jpg",
        }),
      );
    });

    it("should NOT generate photo when location is same as last on same day", async () => {
      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: {
          weekday: [weekdayEntry],
          weekend: mockSchedule.weekend,
        },
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();

      // First tick: location changes from "" to "bedroom" → photo generated
      await capturedTicks[0]!();
      const firstCallCount = vi.mocked(mockGenerateSelfie).mock.calls.length;

      // Second tick same day, same location: should NOT generate photo again
      await capturedTicks[0]!();

      expect(mockGenerateSelfie).toHaveBeenCalledTimes(firstCallCount);
    });

    it("should generate photo on new day even if location is same", async () => {
      vi.mocked(mockGenerateSelfie).mockResolvedValue("https://cdn.fal.media/photo.jpg");

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const adapter = createMockAdapter();
        const scheduler = new ClawraScheduler({
          profile: mockProfile,
          schedule: {
            weekday: [weekdayEntry],
            weekend: mockSchedule.weekend,
          },
          adapters: [adapter],
          targetChatId: "12345",
          timezone: "Asia/Shanghai",
        });

        scheduler.start();

        // Day 1 tick: location changes "" → "bedroom", photo sent
        vi.setSystemTime(new Date("2026-01-01T07:15:00"));
        await capturedTicks[0]!();
        expect(mockGenerateSelfie).toHaveBeenCalledTimes(1);

        // Day 2 tick: same location "bedroom", but new day → should send photo again
        vi.setSystemTime(new Date("2026-01-02T07:15:00"));
        await capturedTicks[0]!();
        expect(mockGenerateSelfie).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should send message without photo when sendPhoto=false", async () => {
      const adapter = createMockAdapter();
      const noPhotoEntry: ScheduleEntry = {
        ...weekdayEntry,
        sendPhoto: false,
        location: "newplace",
      };

      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: {
          weekday: [noPhotoEntry],
          weekend: mockSchedule.weekend,
        },
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();
      await capturedTicks[0]!();

      expect(mockGenerateSelfie).not.toHaveBeenCalled();
      const call = (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as OutgoingMessage;
      expect(call.mediaUrl).toBeUndefined();
    });

    it("should still send text message when photo generation returns null", async () => {
      vi.mocked(mockGenerateSelfie).mockResolvedValue(null);

      const adapter = createMockAdapter();
      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: {
          weekday: [{ ...weekdayEntry, location: "unique-place" }],
          weekend: mockSchedule.weekend,
        },
        adapters: [adapter],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();
      await capturedTicks[0]!();

      expect(adapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "早安~" }),
      );
      const call = (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as OutgoingMessage;
      expect(call.mediaUrl).toBeUndefined();
    });

    it("should send to all adapters serially", async () => {
      const adapter1 = createMockAdapter();
      const adapter2 = createMockAdapter();

      const scheduler = new ClawraScheduler({
        profile: mockProfile,
        schedule: {
          weekday: [{ ...weekdayEntry, location: "somewhere" }],
          weekend: mockSchedule.weekend,
        },
        adapters: [adapter1, adapter2],
        targetChatId: "12345",
        timezone: "Asia/Shanghai",
      });

      scheduler.start();
      await capturedTicks[0]!();

      expect(adapter1.sendMessage).toHaveBeenCalledTimes(1);
      expect(adapter2.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
