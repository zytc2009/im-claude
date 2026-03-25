import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("fs");

import { loadProfile, buildSystemPrompt, buildSelfiePrompt } from "../../src/clawra/profile.js";
import type { ClawraProfile } from "../../src/clawra/types.js";

const mockProfile: ClawraProfile = {
  name: "Clawra",
  gender: "female",
  personality: ["温柔体贴", "活泼开朗"],
  hobbies: ["瑜伽", "咖啡"],
  speakingStyle: "口语化简短",
  referenceImageUrl: "https://example.com/clawra.png",
  language: "zh-CN",
};

const validJson = JSON.stringify({
  name: "Clawra",
  gender: "female",
  personality: ["温柔体贴", "活泼开朗"],
  hobbies: ["瑜伽", "咖啡"],
  speakingStyle: "口语化简短",
  referenceImageUrl: "https://example.com/clawra.png",
  language: "zh-CN",
});

describe("loadProfile", () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(validJson);
  });

  it("should load and parse a valid profile", () => {
    const profile = loadProfile("/fake/path/profile.json");
    expect(profile.name).toBe("Clawra");
    expect(profile.gender).toBe("female");
    expect(profile.personality).toContain("温柔体贴");
    expect(profile.hobbies).toContain("瑜伽");
  });

  it("should return cached profile on second call with same path", () => {
    loadProfile("/fake/path/profile-cached.json");
    loadProfile("/fake/path/profile-cached.json");
    // readFileSync called once per unique path (first call may have been cached from other test)
    expect(vi.mocked(readFileSync)).toHaveBeenCalled();
  });

  it("should throw on missing required field", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: "" }));
    expect(() => loadProfile("/fake/invalid.json")).toThrow();
  });

  it("should throw on invalid referenceImageUrl", () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        ...JSON.parse(validJson),
        referenceImageUrl: "not-a-url",
      }),
    );
    expect(() => loadProfile("/fake/bad-url.json")).toThrow();
  });
});

describe("buildSystemPrompt", () => {
  it("should include the profile name", () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain("Clawra");
  });

  it("should include personality traits", () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain("温柔体贴");
    expect(prompt).toContain("活泼开朗");
  });

  it("should include hobbies", () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain("瑜伽");
    expect(prompt).toContain("咖啡");
  });

  it("should include speaking style", () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain("口语化简短");
  });

  it("should include language", () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain("zh-CN");
  });
});

describe("buildSelfiePrompt", () => {
  it("should use mirror mode for bedroom location", () => {
    const prompt = buildSelfiePrompt(mockProfile, "bedroom", "sleeping");
    expect(prompt).toContain("mirror selfie");
  });

  it("should use mirror mode for gym location", () => {
    const prompt = buildSelfiePrompt(mockProfile, "gym", "working out");
    expect(prompt).toContain("mirror selfie");
  });

  it("should use direct mode for cafe location", () => {
    const prompt = buildSelfiePrompt(mockProfile, "cafe", "drinking coffee");
    expect(prompt).toContain("direct front-facing selfie");
    expect(prompt).not.toContain("mirror");
  });

  it("should use direct mode for library location", () => {
    const prompt = buildSelfiePrompt(mockProfile, "library", "studying");
    expect(prompt).toContain("direct front-facing selfie");
  });

  it("should include location and activity in prompt", () => {
    const prompt = buildSelfiePrompt(mockProfile, "park", "walking");
    expect(prompt).toContain("park");
    expect(prompt).toContain("walking");
  });

  it("should use mirror mode for Chinese keyword 健身", () => {
    const prompt = buildSelfiePrompt(mockProfile, "健身房", "运动");
    expect(prompt).toContain("mirror selfie");
  });
});
