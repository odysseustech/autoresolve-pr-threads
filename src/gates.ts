import { minimatch } from "minimatch";
import type { FileAccess } from "./git.js";
import type { GateVerdict, PullRequestContext, ReviewThread } from "./types.js";

export interface GateContext {
  pr: PullRequestContext;
  botLogins: Set<string>;
  generatedGlobs: string[];
  git: FileAccess;
}

type Gate = (thread: ReviewThread, ctx: GateContext) => Promise<GateVerdict | null>;

const gateAlreadyResolved: Gate = async (t) =>
  t.isResolved ? { kind: "skip", reason: "already-resolved" } : null;

const gateAllOutdated: Gate = async (t) =>
  t.isOutdated && t.comments.length > 0
    ? { kind: "auto-resolve", reason: "all-comments-outdated" }
    : null;

const gateNonBotAuthor: Gate = async (t, { botLogins }) => {
  const first = t.comments[0];
  if (!first) return { kind: "skip", reason: "no-line-anchor" };
  const login = (first.author?.login ?? "").toLowerCase();
  return botLogins.has(login) ? null : { kind: "skip", reason: "non-bot-author" };
};

const gateNoLineAnchor: Gate = async (t) => {
  const c = t.comments[0];
  if (!c) return null;
  const line = c.line ?? c.originalLine;
  return line == null ? { kind: "skip", reason: "no-line-anchor" } : null;
};

const gateGeneratedFile: Gate = async (t, { generatedGlobs }) => {
  const c = t.comments[0];
  if (!c) return null;
  const hit = generatedGlobs.some((g) => minimatch(c.path, g, { dot: true }));
  return hit ? { kind: "auto-resolve", reason: "generated-file" } : null;
};

const gateFileDeleted: Gate = async (t, { pr, git }) => {
  const c = t.comments[0];
  if (!c) return null;
  const exists = await git.fileExistsAtRef(c.path, pr.headSha);
  return exists ? null : { kind: "auto-resolve", reason: "file-deleted-at-head" };
};

const gateLineUnchanged: Gate = async (t, { pr, git }) => {
  const c = t.comments[0];
  if (!c || !c.originalCommit) return null;
  const line = c.line ?? c.originalLine;
  if (line == null) return null;
  const original = await git.readLineWindow(c.path, c.originalCommit.oid, line, 5);
  const current = await git.readLineWindow(c.path, pr.headSha, line, 5);
  if (original == null || current == null) return null;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(original) === norm(current)
    ? { kind: "skip", reason: "line-unchanged-at-head" }
    : null;
};

const CHAIN: Gate[] = [
  gateAlreadyResolved,
  gateAllOutdated,
  gateNonBotAuthor,
  gateNoLineAnchor,
  gateGeneratedFile,
  gateFileDeleted,
  gateLineUnchanged,
];

export async function runGates(thread: ReviewThread, ctx: GateContext): Promise<GateVerdict> {
  for (const gate of CHAIN) {
    const v = await gate(thread, ctx);
    if (v) return v;
  }
  return { kind: "needs-classification" };
}
