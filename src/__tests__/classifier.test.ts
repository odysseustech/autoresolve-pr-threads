import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create },
    })),
    __create: create,
  };
});

import Anthropic from "@anthropic-ai/sdk";
import { createClassifier } from "../classifier.js";
import type { FileAccess } from "../git.js";
import type { PullRequestContext, ReviewThread } from "../types.js";

const pr: PullRequestContext = {
  owner: "odysseustech",
  repo: "test",
  number: 1,
  headSha: "head",
};

const git: FileAccess = {
  fileExistsAtRef: vi.fn().mockResolvedValue(true),
  readFileAtRef: vi.fn().mockResolvedValue("content"),
  readLineWindow: vi.fn().mockResolvedValue("some code line"),
};

const thread: ReviewThread = {
  id: "t1",
  isResolved: false,
  isOutdated: false,
  comments: [
    {
      id: "c1",
      databaseId: 1,
      author: { login: "coderabbitai[bot]" },
      body: "This variable is unused.",
      path: "src/a.ts",
      line: 10,
      originalLine: 10,
      originalCommit: { oid: "orig" },
      createdAt: "2026-04-20T00:00:00Z",
      url: "https://...",
    },
  ],
};

function getCreateMock() {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  const instance = (Anthropic as any).mock.results[0]?.value;
  return instance?.messages?.create as ReturnType<typeof vi.fn>;
}

function makeResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("createClassifier", () => {
  it("returns addressed for YES verdict", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    getCreateMock().mockResolvedValueOnce(makeResponse('{"verdict":"YES","reason":"fixed it"}'));
    const result = await classify(thread, { pr, git });
    expect(result).toEqual({ kind: "addressed", reason: "fixed it" });
  });

  it("returns not-addressed for NO verdict", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    getCreateMock().mockResolvedValueOnce(makeResponse('{"verdict":"NO","reason":"still broken"}'));
    const result = await classify(thread, { pr, git });
    expect(result).toEqual({ kind: "not-addressed", reason: "still broken" });
  });

  it("returns unclear for UNCLEAR verdict", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    getCreateMock().mockResolvedValueOnce(
      makeResponse('{"verdict":"UNCLEAR","reason":"cannot tell"}'),
    );
    const result = await classify(thread, { pr, git });
    expect(result).toEqual({ kind: "unclear", reason: "cannot tell" });
  });

  it("returns unclear when SDK throws", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    getCreateMock().mockRejectedValueOnce(new Error("network error"));
    const result = await classify(thread, { pr, git });
    expect(result.kind).toBe("unclear");
    expect(result.reason).toMatch(/classifier error/);
  });

  it("returns unclear when response JSON is malformed", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    getCreateMock().mockResolvedValueOnce(makeResponse("not json at all"));
    const result = await classify(thread, { pr, git });
    expect(result.kind).toBe("unclear");
  });

  it("returns unclear when originalCommit is missing", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    const baseComment = thread.comments[0];
    if (!baseComment) throw new Error("unreachable");
    const noCommit: ReviewThread = {
      ...thread,
      comments: [{ ...baseComment, originalCommit: null }],
    };
    const result = await classify(noCommit, { pr, git });
    expect(result).toEqual({ kind: "unclear", reason: "missing anchor data" });
  });

  it("returns unclear when line anchor is missing", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    const baseComment = thread.comments[0];
    if (!baseComment) throw new Error("unreachable");
    const noLine: ReviewThread = {
      ...thread,
      comments: [{ ...baseComment, line: null, originalLine: null }],
    };
    const result = await classify(noLine, { pr, git });
    expect(result).toEqual({ kind: "unclear", reason: "no line anchor" });
  });

  it("includes CONCERN and CURRENT CODE AT HEAD in the prompt", async () => {
    const classify = createClassifier("sk-test", "claude-haiku-4-5-20251001");
    getCreateMock().mockResolvedValueOnce(makeResponse('{"verdict":"YES","reason":"ok"}'));
    await classify(thread, { pr, git });
    const callArg = getCreateMock().mock.calls.at(-1)?.[0];
    const prompt = callArg?.messages?.[0]?.content as string;
    expect(prompt).toContain("CONCERN");
    expect(prompt).toContain("CURRENT CODE AT HEAD");
    expect(prompt).toContain("Respond ONLY as JSON");
  });
});
