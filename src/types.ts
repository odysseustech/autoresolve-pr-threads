export interface ReviewComment {
  id: string;
  databaseId: number;
  author: { login: string } | null;
  body: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  originalCommit: { oid: string } | null;
  createdAt: string;
  url: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewComment[];
}

export interface PullRequestContext {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
}

export type GateVerdict =
  | { kind: "skip"; reason: SkipReason }
  | { kind: "auto-resolve"; reason: AutoResolveReason }
  | { kind: "needs-classification" };

export type SkipReason =
  | "already-resolved"
  | "non-bot-author"
  | "no-line-anchor"
  | "line-unchanged-at-head";

export type AutoResolveReason = "all-comments-outdated" | "file-deleted-at-head" | "generated-file";

export type ClassificationVerdict =
  | { kind: "addressed"; reason: string }
  | { kind: "not-addressed"; reason: string }
  | { kind: "unclear"; reason: string };

export interface ThreadDecision {
  thread: ReviewThread;
  verdict:
    | { source: "gate"; gate: GateVerdict }
    | { source: "classifier"; classification: ClassificationVerdict };
}
