import { describe, expect, it, vi } from "vitest";
import { runGates } from "../gates.js";
import type { FileAccess } from "../git.js";
import type { PullRequestContext, ReviewThread } from "../types.js";

const pr: PullRequestContext = {
  owner: "odysseustech",
  repo: "test",
  number: 1,
  headSha: "head",
};

const mkGit = (overrides: Partial<FileAccess> = {}): FileAccess => ({
  fileExistsAtRef: vi.fn().mockResolvedValue(true),
  readFileAtRef: vi.fn().mockResolvedValue("content"),
  readLineWindow: vi.fn().mockResolvedValue("line"),
  ...overrides,
});

const mkThread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "t1",
  isResolved: false,
  isOutdated: false,
  comments: [
    {
      id: "c1",
      databaseId: 1,
      author: { login: "coderabbitai[bot]" },
      body: "issue",
      path: "src/a.ts",
      line: 10,
      originalLine: 10,
      originalCommit: { oid: "orig" },
      createdAt: "2026-04-20T00:00:00Z",
      url: "https://...",
    },
  ],
  ...overrides,
});

const ctx = {
  pr,
  botLogins: new Set(["coderabbitai[bot]"]),
  generatedGlobs: ["**/generated/**"],
  git: mkGit(),
};

describe("gates", () => {
  it("skips resolved threads", async () => {
    expect(await runGates(mkThread({ isResolved: true }), ctx)).toEqual({
      kind: "skip",
      reason: "already-resolved",
    });
  });

  it("auto-resolves outdated threads", async () => {
    expect(await runGates(mkThread({ isOutdated: true }), ctx)).toEqual({
      kind: "auto-resolve",
      reason: "all-comments-outdated",
    });
  });

  it("skips threads with no comments via gateNonBotAuthor", async () => {
    expect(await runGates(mkThread({ comments: [] }), ctx)).toEqual({
      kind: "skip",
      reason: "no-line-anchor",
    });
  });

  it("skips non-bot authors", async () => {
    const t = mkThread();
    const [c] = t.comments;
    if (!c) throw new Error("unreachable");
    c.author = { login: "fenix" };
    expect(await runGates(t, ctx)).toEqual({ kind: "skip", reason: "non-bot-author" });
  });

  it("auto-resolves generated files", async () => {
    const t = mkThread();
    const [c] = t.comments;
    if (!c) throw new Error("unreachable");
    c.path = "src/generated/types.ts";
    expect(await runGates(t, ctx)).toEqual({ kind: "auto-resolve", reason: "generated-file" });
  });

  it("auto-resolves when file deleted", async () => {
    const customCtx = {
      ...ctx,
      git: mkGit({ fileExistsAtRef: vi.fn().mockResolvedValue(false) }),
    };
    expect(await runGates(mkThread(), customCtx)).toEqual({
      kind: "auto-resolve",
      reason: "file-deleted-at-head",
    });
  });

  it("skips when line unchanged", async () => {
    const customCtx = {
      ...ctx,
      git: mkGit({ readLineWindow: vi.fn().mockResolvedValue("same") }),
    };
    expect(await runGates(mkThread(), customCtx)).toEqual({
      kind: "skip",
      reason: "line-unchanged-at-head",
    });
  });

  it("falls through to classification when all gates pass", async () => {
    const customCtx = {
      ...ctx,
      git: mkGit({
        readLineWindow: vi
          .fn()
          .mockResolvedValueOnce("original line")
          .mockResolvedValueOnce("changed line"),
      }),
    };
    expect(await runGates(mkThread(), customCtx)).toEqual({ kind: "needs-classification" });
  });
});
