import * as core from "@actions/core";
import * as github from "@actions/github";
import { createClassifier } from "./classifier.js";
import { loadConfig } from "./config.js";
import { runGates } from "./gates.js";
import { createGit } from "./git.js";
import { createGitHubClient } from "./github.js";
import type { PullRequestContext, ThreadDecision } from "./types.js";

async function run(): Promise<void> {
  const cfg = loadConfig();
  const ctx = github.context;

  if (ctx.eventName !== "pull_request" && ctx.eventName !== "workflow_dispatch") {
    core.warning(`Unsupported event: ${ctx.eventName}. Exiting.`);
    return;
  }

  const gh = createGitHubClient(cfg.githubToken);

  let pr: PullRequestContext;

  if (ctx.eventName === "workflow_dispatch") {
    const prNumberStr = core.getInput("pr-number");
    if (!prNumberStr) {
      core.setFailed("workflow_dispatch requires the pr-number input.");
      return;
    }
    const prNumber = Number.parseInt(prNumberStr, 10);
    if (Number.isNaN(prNumber)) {
      core.setFailed(`pr-number must be an integer, got: ${prNumberStr}`);
      return;
    }
    const prData = await gh.getPullRequest(ctx.repo.owner, ctx.repo.repo, prNumber);
    if (prData.headRepoFullName !== prData.baseRepoFullName) {
      core.info("Fork PR detected; skipping for safety.");
      return;
    }
    pr = {
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      number: prData.number,
      headSha: prData.headSha,
    };
  } else {
    const prPayload = ctx.payload.pull_request;
    if (!prPayload) {
      core.warning("No pull_request in payload. Exiting.");
      return;
    }
    // Fork PRs: skip for safety — crafted bot comments could manipulate the classifier.
    if (prPayload.head.repo.full_name !== prPayload.base.repo.full_name) {
      core.info("Fork PR detected; skipping for safety.");
      return;
    }
    pr = {
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      number: prPayload.number as number,
      headSha: prPayload.head.sha as string,
    };
  }
  const git = createGit();
  const classify = createClassifier(cfg.anthropicApiKey, cfg.model);

  const threads = await gh.fetchReviewThreads(pr);
  core.info(`Fetched ${threads.length} review threads`);

  const gateCtx = {
    pr,
    botLogins: new Set(cfg.botLogins),
    generatedGlobs: cfg.generatedFileGlobs,
    git,
  };

  const decisions: ThreadDecision[] = [];
  for (const thread of threads) {
    const gateVerdict = await runGates(thread, gateCtx);
    if (gateVerdict.kind === "needs-classification") {
      const classification = await classify(thread, { pr, git });
      decisions.push({ thread, verdict: { source: "classifier", classification } });
    } else {
      decisions.push({ thread, verdict: { source: "gate", gate: gateVerdict } });
    }
  }

  let resolved = 0;
  let skipped = 0;
  let classified = 0;
  for (const d of decisions) {
    const shouldResolve =
      (d.verdict.source === "gate" && d.verdict.gate.kind === "auto-resolve") ||
      (d.verdict.source === "classifier" && d.verdict.classification.kind === "addressed");
    if (d.verdict.source === "classifier") classified++;

    if (!shouldResolve) {
      skipped++;
      continue;
    }
    if (resolved >= cfg.maxResolutionsPerRun) {
      core.warning(`Hit max-resolutions-per-run cap (${cfg.maxResolutionsPerRun}); stopping.`);
      break;
    }
    if (cfg.dryRun) {
      core.info(`[dry-run] would resolve ${d.thread.id}`);
    } else {
      await gh.resolveReviewThread(d.thread.id);
      core.info(`Resolved ${d.thread.id}`);
    }
    resolved++;
  }

  core.setOutput("resolved-count", resolved);
  core.setOutput("skipped-count", skipped);
  core.setOutput("classified-count", classified);

  core.summary
    .addHeading("autoresolve-pr-threads")
    .addRaw(`Dry run: ${cfg.dryRun ? "yes" : "no"}\n`)
    .addRaw(`Threads fetched: ${threads.length}\n`)
    .addRaw(`Resolved: ${resolved} · Skipped: ${skipped} · Classified: ${classified}\n`)
    .write();
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
