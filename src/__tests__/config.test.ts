import { describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
}));

import * as core from "@actions/core";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("parses valid inputs and lowercases bot logins", () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        "anthropic-api-key": "sk-ant-test",
        "github-token": "ghs_token",
        "bot-logins": "CodeRabbitAI[bot], Greptile-Apps[bot]",
        model: "claude-haiku-4-5-20251001",
        "max-resolutions-per-run": "20",
        "generated-file-globs": "**/generated/**,**/dist/**",
      };
      return inputs[name] ?? "";
    });
    vi.mocked(core.getBooleanInput).mockReturnValue(true);

    const cfg = loadConfig();

    expect(cfg.anthropicApiKey).toBe("sk-ant-test");
    expect(cfg.githubToken).toBe("ghs_token");
    expect(cfg.dryRun).toBe(true);
    expect(cfg.botLogins).toEqual(["coderabbitai[bot]", "greptile-apps[bot]"]);
    expect(cfg.model).toBe("claude-haiku-4-5-20251001");
    expect(cfg.maxResolutionsPerRun).toBe(20);
    expect(cfg.generatedFileGlobs).toEqual(["**/generated/**", "**/dist/**"]);
  });

  it("throws when anthropic-api-key is missing", () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      if (name === "anthropic-api-key") return "";
      if (name === "github-token") return "ghs_token";
      if (name === "bot-logins") return "coderabbitai[bot]";
      if (name === "model") return "claude-haiku-4-5-20251001";
      if (name === "max-resolutions-per-run") return "20";
      if (name === "generated-file-globs") return "**/generated/**";
      return "";
    });
    vi.mocked(core.getBooleanInput).mockReturnValue(false);

    expect(() => loadConfig()).toThrow();
  });
});
