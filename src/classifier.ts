import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { FileAccess } from "./git.js";
import type { ClassificationVerdict, PullRequestContext, ReviewThread } from "./types.js";

const ResponseSchema = z.object({
  verdict: z.enum(["YES", "NO", "UNCLEAR"]),
  reason: z.string().max(280),
});

export function createClassifier(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey });

  return async function classify(
    thread: ReviewThread,
    ctx: { pr: PullRequestContext; git: FileAccess },
  ): Promise<ClassificationVerdict> {
    const c = thread.comments[0];
    if (!c || !c.originalCommit) return { kind: "unclear", reason: "missing anchor data" };
    const line = c.line ?? c.originalLine;
    if (line == null) return { kind: "unclear", reason: "no line anchor" };

    const original = await ctx.git.readLineWindow(c.path, c.originalCommit.oid, line, 5);
    const current = await ctx.git.readLineWindow(c.path, ctx.pr.headSha, line, 5);

    const prompt = [
      `CONCERN (from ${c.author?.login ?? "bot"}):`,
      c.body.slice(0, 1500),
      "",
      `ORIGINAL CODE (file: ${c.path}, line ~${line}):`,
      original ?? "(unavailable)",
      "",
      "CURRENT CODE AT HEAD:",
      current ?? "(line no longer present)",
      "",
      "Has the concern been addressed in the current code?",
      'Respond ONLY as JSON: {"verdict": "YES" | "NO" | "UNCLEAR", "reason": "<one sentence>"}',
      "YES means the concern is clearly resolved by the current code.",
      "NO means the concern is clearly still present.",
      "UNCLEAR means insufficient information to decide; default to this when unsure.",
    ].join("\n");

    try {
      const res = await client.messages.create({
        model,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      });
      const text = res.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") {
        return { kind: "unclear", reason: "empty response" };
      }
      const clean = text.text.replace(/```(?:json)?|```/g, "").trim();
      const parsed = ResponseSchema.parse(JSON.parse(clean));

      if (parsed.verdict === "YES") return { kind: "addressed", reason: parsed.reason };
      if (parsed.verdict === "NO") return { kind: "not-addressed", reason: parsed.reason };
      return { kind: "unclear", reason: parsed.reason };
    } catch (err) {
      return { kind: "unclear", reason: `classifier error: ${(err as Error).message}` };
    }
  };
}
