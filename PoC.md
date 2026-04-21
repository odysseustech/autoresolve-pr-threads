# `autoresolve-bot-threads`: PoC Build Plan

A public GitHub Action that closes out bot-authored PR review threads once a human has addressed the feedback, so the unresolved-conversations count accurately reflects real work left.

---

## 1. What this action does

When run against a PR, it:

1. Pulls every review thread on that PR via GitHub GraphQL.
2. Runs each thread through a **deterministic gate chain** that filters out the easy cases (already resolved, commented on generated files, file deleted at HEAD, line unchanged since comment posted, etc.).
3. For the small subset that cannot be decided deterministically, sends a tight prompt to Claude Haiku 4.5 asking a single yes/no question: *is this concern still present in the current code?*
4. Resolves threads where the answer is "yes, addressed" (or a deterministic gate marked it as auto-resolve). Leaves everything else alone.
5. Emits a run summary and outputs (`resolved-count`, `skipped-count`, `classified-count`).

**Starts in dry-run by default.** First rollouts only log decisions. Flipping `dry-run: false` is an explicit opt-in.

---

## 2. Scope of this PoC

**In scope**

- GitHub Action packaged as a public standalone repo at `odysseustech/autoresolve-bot-threads`.
- Node 20 runtime, TypeScript strict, bundled via `@vercel/ncc` into `dist/index.js`.
- Deterministic gate chain (7 gates, listed below).
- Single Haiku 4.5 call per ambiguous thread (no batching).
- Dry-run by default, hard cap on resolutions per run.
- Target bots: CodeRabbit, Greptile, Copilot, Cursor/Bugbot.
- Consumer workflow triggers: `pull_request` (`synchronize`, `opened`) and `workflow_dispatch`.

**Explicitly deferred (do not build in PoC)**

- Batched classifier calls.
- Audit reply comments posted under a dedicated bot identity.
- Tier-0 "suggestion block applied" detection.
- Human-replied-in-thread detection.
- Idempotency markers keyed on HEAD SHA.
- Per-bot signal weighting, commit-message heuristics.
- `pull_request_review_comment` trigger with debouncing.

These are tracked for v0.2 but are not required to prove the concept.

---

## 3. Architecture in 30 seconds

```
PR HEAD pushed
   │
   ▼
fetch reviewThreads (GraphQL)
   │
   ▼
for each thread:
   │
   ├── Gate chain (pure, no API cost)
   │     ├── already resolved? → skip
   │     ├── all comments outdated? → auto-resolve
   │     ├── author not in bot allowlist? → skip
   │     ├── no line anchor? → skip
   │     ├── path matches generated glob? → auto-resolve
   │     ├── file deleted at HEAD? → auto-resolve
   │     └── commented line unchanged at HEAD? → skip
   │
   ▼
remaining threads → Haiku 4.5 (one call each)
   │     YES addressed → resolve
   │     NO / UNCLEAR → skip
   ▼
apply decisions (respect dry-run + max-resolutions cap)
   │
   ▼
emit action outputs + summary
```

---

## 4. Tech stack (pinned)

Every dependency below is pinned because the PoC must be reproducible from this plan alone.

| Dependency          | Version    | Purpose                                              |
| ------------------- | ---------- | ---------------------------------------------------- |
| `@actions/core`     | `^1.11.1`  | Action inputs/outputs/logging                        |
| `@actions/github`   | `^6.0.0`   | Octokit client with `GITHUB_TOKEN` pre-auth'd        |
| `@actions/exec`     | `^1.1.1`   | Shell out to `git`                                   |
| `@anthropic-ai/sdk` | `^0.90.0`  | Haiku calls. API surface: `client.messages.create()` |
| `minimatch`         | `^10.0.1`  | Generated-file glob matching                         |
| `zod`               | `^3.23.8`  | Input + classifier response validation               |
| `typescript`        | `^5.6.3`   | Language. Strict mode.                               |
| `@vercel/ncc`       | `^0.38.2`  | Bundle to single `dist/index.js`                     |
| `@biomejs/biome`    | `^1.9.4`   | Lint + format                                        |
| `vitest`            | `^2.1.4`   | Tests                                                |
| `@types/node`       | `^20.17.0` | Types                                                |

Package manager: **pnpm 9.12.0**. Node runtime: **20**.

Model ID for classifier: `claude-haiku-4-5-20251001`.

---

## 5. Execution order (phases for the implementing agent)

Work in this order. Each phase should end in a committed, green-test state.

### Phase 0: Initialize repo
- `pnpm init`, set `"type": "module"`, install deps above.
- Create `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc` pinning `20`.
- Set up `lefthook.yml` running `pnpm biome check` and `pnpm typecheck` pre-commit.

### Phase 1: Type contracts + config parsing
- `src/types.ts` (section 7).
- `src/config.ts` with zod schema for action inputs (section 7).
- Unit test: zod parser accepts valid input, rejects missing API key.

### Phase 2: Git wrapper
- `src/git.ts` with `fileExistsAtRef`, `readFileAtRef`, `readLineWindow` using `git show` and `git cat-file -e`.
- Unit test: mock `@actions/exec`, assert correct git commands issued.

### Phase 3: GitHub client
- `src/github.ts` with `fetchReviewThreads(pr)` and `resolveReviewThread(threadId)`.
- Use `getOctokit(token).graphql(...)`.
- No unit test for this in PoC; covered by the live smoke test in Phase 6.

### Phase 4: Gate chain
- `src/gates.ts` with the 7 gates as pure async functions returning `GateVerdict | null`.
- Unit tests covering each gate: this is the module that most needs tests because the logic is where bugs would cause real damage (wrongly resolving human feedback, etc.).

### Phase 5: Classifier
- `src/classifier.ts` with one function `classifyThread(thread, ctx)` that builds the prompt, calls Haiku, parses response via zod.
- Returns `{ kind: 'addressed' | 'not-addressed' | 'unclear', reason: string }`.
- On API error: return `{ kind: 'unclear', reason: 'classifier error' }`. Never throws, never escalates failure to the run.
- Unit test: mock the SDK, assert prompt shape and parsing.

### Phase 6: Orchestration + smoke test
- `src/index.ts` wiring fetch → gates → classify → resolve.
- Respect `dry-run` and `max-resolutions-per-run` cap.
- Set action outputs, log a summary table.
- **Manual smoke test:** run against a real PR on a throwaway private repo with dry-run on. Verify thread discovery and gate verdicts in logs before ever shipping v0.1.

### Phase 7: Package + publish
- `pnpm build` produces `dist/index.js`.
- Commit `dist/`. GitHub Actions requires the bundled output to be checked in.
- Write `action.yml` (section 7).
- Write `README.md` with one consumer-repo workflow example.
- Tag `v0.1.0`. Create release.

---

## 6. File layout

```
autoresolve-bot-threads/
├── action.yml
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── lefthook.yml
├── .gitignore
├── .nvmrc
├── README.md
├── dist/                    # ncc output, committed
│   └── index.js
└── src/
    ├── index.ts             # orchestration
    ├── config.ts            # input parsing
    ├── types.ts             # shared contracts
    ├── github.ts            # GraphQL client
    ├── git.ts               # git CLI wrapper
    ├── gates.ts             # gate chain
    ├── classifier.ts        # Haiku call
    └── __tests__/
        ├── gates.test.ts
        ├── config.test.ts
        └── classifier.test.ts
```

Eight source files. Three test files. Keeps it legible.

---

## 7. File-by-file specs with key code

### `action.yml`

Canonical GitHub Actions metadata syntax. `using: node20` is the current supported Node runtime for JavaScript actions.

```yaml
name: 'Auto-Resolve Bot Review Threads'
description: 'Resolves addressed bot review comments on PRs using a deterministic gate chain and Claude Haiku.'
author: 'odysseustech'

branding:
  icon: 'check-circle'
  color: 'purple'

inputs:
  anthropic-api-key:
    description: 'Anthropic API key for the Haiku classifier.'
    required: true
  github-token:
    description: 'Token with pull-requests:write and contents:read.'
    required: false
    default: ${{ github.token }}
  dry-run:
    description: 'If true, log decisions but do not resolve threads.'
    required: false
    default: 'true'
  bot-logins:
    description: 'Comma-separated allowlist of bot login names (without [bot] suffix is also accepted).'
    required: false
    default: 'coderabbitai[bot],greptile-apps[bot],copilot-pull-request-reviewer[bot],cursor[bot]'
  model:
    description: 'Anthropic model id.'
    required: false
    default: 'claude-haiku-4-5-20251001'
  max-resolutions-per-run:
    description: 'Hard cap on auto-resolutions in a single run.'
    required: false
    default: '20'
  generated-file-globs:
    description: 'Comma-separated globs for generated files (auto-resolved without AI).'
    required: false
    default: '**/generated/**,**/*.generated.*,**/dist/**,**/build/**,**/package-lock.json,**/pnpm-lock.yaml,**/bun.lockb,**/yarn.lock,**/prisma/migrations/**'

outputs:
  resolved-count:
    description: 'Number of threads resolved this run.'
  skipped-count:
    description: 'Number of threads skipped.'
  classified-count:
    description: 'Number of threads that reached the AI classifier.'

runs:
  using: 'node20'
  main: 'dist/index.js'
```

### `src/types.ts`

```ts
export interface ReviewComment {
  id: string
  databaseId: number
  author: { login: string } | null
  body: string
  path: string
  line: number | null
  originalLine: number | null
  originalCommit: { oid: string } | null
  createdAt: string
  url: string
}

export interface ReviewThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  comments: ReviewComment[]
}

export interface PullRequestContext {
  owner: string
  repo: string
  number: number
  headSha: string
}

export type GateVerdict =
  | { kind: 'skip'; reason: SkipReason }
  | { kind: 'auto-resolve'; reason: AutoResolveReason }
  | { kind: 'needs-classification' }

export type SkipReason =
  | 'already-resolved'
  | 'non-bot-author'
  | 'no-line-anchor'
  | 'line-unchanged-at-head'

export type AutoResolveReason =
  | 'all-comments-outdated'
  | 'file-deleted-at-head'
  | 'generated-file'

export type ClassificationVerdict =
  | { kind: 'addressed'; reason: string }
  | { kind: 'not-addressed'; reason: string }
  | { kind: 'unclear'; reason: string }

export interface ThreadDecision {
  thread: ReviewThread
  verdict:
    | { source: 'gate'; gate: GateVerdict }
    | { source: 'classifier'; classification: ClassificationVerdict }
}
```

### `src/config.ts`

Input parsing. Normalizes bot-login casing and strips whitespace.

```ts
import * as core from '@actions/core'
import { z } from 'zod'

const ConfigSchema = z.object({
  anthropicApiKey: z.string().min(1, 'anthropic-api-key is required'),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
  botLogins: z.array(z.string().min(1)),
  model: z.string().min(1),
  maxResolutionsPerRun: z.number().int().positive(),
  generatedFileGlobs: z.array(z.string().min(1)),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(): Config {
  const parseCsv = (raw: string): string[] =>
    raw.split(',').map((s) => s.trim()).filter(Boolean)

  return ConfigSchema.parse({
    anthropicApiKey: core.getInput('anthropic-api-key', { required: true }),
    githubToken: core.getInput('github-token', { required: true }),
    dryRun: core.getBooleanInput('dry-run'),
    botLogins: parseCsv(core.getInput('bot-logins')).map((s) => s.toLowerCase()),
    model: core.getInput('model'),
    maxResolutionsPerRun: Number.parseInt(core.getInput('max-resolutions-per-run'), 10),
    generatedFileGlobs: parseCsv(core.getInput('generated-file-globs')),
  })
}
```

### `src/github.ts`

**Canonical GraphQL query** (uses `reviewThreads` field on `PullRequest`, which exposes `isResolved`, `isOutdated`, and the nested comments):

```ts
import * as github from '@actions/github'
import type { PullRequestContext, ReviewThread } from './types.js'

const THREADS_QUERY = /* GraphQL */ `
  query ($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            comments(first: 20) {
              nodes {
                id
                databaseId
                author { login }
                body
                path
                line
                originalLine
                originalCommit { oid }
                createdAt
                url
              }
            }
          }
        }
      }
    }
  }
`

const RESOLVE_MUTATION = /* GraphQL */ `
  mutation ($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`

export function createGitHubClient(token: string) {
  const octokit = github.getOctokit(token)

  return {
    async fetchReviewThreads(pr: PullRequestContext): Promise<ReviewThread[]> {
      const all: ReviewThread[] = []
      let cursor: string | null = null
      // paginate until hasNextPage is false
      do {
        const res: any = await octokit.graphql(THREADS_QUERY, {
          owner: pr.owner,
          repo: pr.repo,
          pr: pr.number,
          cursor,
        })
        const conn = res.repository.pullRequest.reviewThreads
        for (const node of conn.nodes) {
          all.push({
            id: node.id,
            isResolved: node.isResolved,
            isOutdated: node.isOutdated,
            comments: node.comments.nodes,
          })
        }
        cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
      } while (cursor)
      return all
    },

    async resolveReviewThread(threadId: string): Promise<void> {
      await octokit.graphql(RESOLVE_MUTATION, { threadId })
    },
  }
}
```

### `src/git.ts`

Relies on `actions/checkout@v4` having been run first in the consumer workflow with `fetch-depth: 0` so that `originalCommit.oid` is locally available.

```ts
import * as exec from '@actions/exec'

export interface FileAccess {
  fileExistsAtRef(path: string, ref: string): Promise<boolean>
  readFileAtRef(path: string, ref: string): Promise<string | null>
  readLineWindow(path: string, ref: string, line: number, pad: number): Promise<string | null>
}

export function createGit(): FileAccess {
  const run = async (args: string[]): Promise<{ stdout: string; code: number }> => {
    let stdout = ''
    const code = await exec.exec('git', args, {
      silent: true,
      ignoreReturnCode: true,
      listeners: { stdout: (b) => { stdout += b.toString() } },
    })
    return { stdout, code }
  }

  return {
    async fileExistsAtRef(path, ref) {
      const { code } = await run(['cat-file', '-e', `${ref}:${path}`])
      return code === 0
    },
    async readFileAtRef(path, ref) {
      const { stdout, code } = await run(['show', `${ref}:${path}`])
      return code === 0 ? stdout : null
    },
    async readLineWindow(path, ref, line, pad) {
      const { stdout, code } = await run(['show', `${ref}:${path}`])
      if (code !== 0) return null
      const lines = stdout.split('\n')
      const start = Math.max(0, line - 1 - pad)
      const end = Math.min(lines.length, line + pad)
      return lines.slice(start, end).join('\n')
    },
  }
}
```

### `src/gates.ts`

The 7 gates for the PoC. Each returns `null` to pass control to the next gate, or a `GateVerdict` to short-circuit.

```ts
import { minimatch } from 'minimatch'
import type { FileAccess } from './git.js'
import type { GateVerdict, PullRequestContext, ReviewThread } from './types.js'

export interface GateContext {
  pr: PullRequestContext
  botLogins: Set<string>
  generatedGlobs: string[]
  git: FileAccess
}

type Gate = (thread: ReviewThread, ctx: GateContext) => Promise<GateVerdict | null>

const gateAlreadyResolved: Gate = async (t) =>
  t.isResolved ? { kind: 'skip', reason: 'already-resolved' } : null

const gateAllOutdated: Gate = async (t) =>
  t.isOutdated && t.comments.length > 0
    ? { kind: 'auto-resolve', reason: 'all-comments-outdated' }
    : null

const gateNonBotAuthor: Gate = async (t, { botLogins }) => {
  const first = t.comments[0]
  if (!first) return { kind: 'skip', reason: 'no-line-anchor' }
  const login = (first.author?.login ?? '').toLowerCase()
  return botLogins.has(login) ? null : { kind: 'skip', reason: 'non-bot-author' }
}

const gateNoLineAnchor: Gate = async (t) => {
  const c = t.comments[0]
  if (!c) return null
  const line = c.line ?? c.originalLine
  return line == null ? { kind: 'skip', reason: 'no-line-anchor' } : null
}

const gateGeneratedFile: Gate = async (t, { generatedGlobs }) => {
  const c = t.comments[0]
  if (!c) return null
  const hit = generatedGlobs.some((g) => minimatch(c.path, g, { dot: true }))
  return hit ? { kind: 'auto-resolve', reason: 'generated-file' } : null
}

const gateFileDeleted: Gate = async (t, { pr, git }) => {
  const c = t.comments[0]
  if (!c) return null
  const exists = await git.fileExistsAtRef(c.path, pr.headSha)
  return exists ? null : { kind: 'auto-resolve', reason: 'file-deleted-at-head' }
}

const gateLineUnchanged: Gate = async (t, { pr, git }) => {
  const c = t.comments[0]
  if (!c || !c.originalCommit) return null
  const line = c.line ?? c.originalLine
  if (line == null) return null
  const original = await git.readLineWindow(c.path, c.originalCommit.oid, line, 5)
  const current = await git.readLineWindow(c.path, pr.headSha, line, 5)
  if (original == null || current == null) return null
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  return norm(original) === norm(current)
    ? { kind: 'skip', reason: 'line-unchanged-at-head' }
    : null
}

const CHAIN: Gate[] = [
  gateAlreadyResolved,
  gateAllOutdated,
  gateNonBotAuthor,
  gateNoLineAnchor,
  gateGeneratedFile,
  gateFileDeleted,
  gateLineUnchanged,
]

export async function runGates(thread: ReviewThread, ctx: GateContext): Promise<GateVerdict> {
  for (const gate of CHAIN) {
    const v = await gate(thread, ctx)
    if (v) return v
  }
  return { kind: 'needs-classification' }
}
```

### `src/classifier.ts`

One call per ambiguous thread. Low-token prompt. Schema-validated output.

```ts
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { FileAccess } from './git.js'
import type { ClassificationVerdict, PullRequestContext, ReviewThread } from './types.js'

const ResponseSchema = z.object({
  verdict: z.enum(['YES', 'NO', 'UNCLEAR']),
  reason: z.string().max(280),
})

export function createClassifier(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey })

  return async function classify(
    thread: ReviewThread,
    ctx: { pr: PullRequestContext; git: FileAccess },
  ): Promise<ClassificationVerdict> {
    const c = thread.comments[0]
    if (!c || !c.originalCommit) return { kind: 'unclear', reason: 'missing anchor data' }
    const line = c.line ?? c.originalLine
    if (line == null) return { kind: 'unclear', reason: 'no line anchor' }

    const original = await ctx.git.readLineWindow(c.path, c.originalCommit.oid, line, 5)
    const current = await ctx.git.readLineWindow(c.path, ctx.pr.headSha, line, 5)

    const prompt = [
      `CONCERN (from ${c.author?.login ?? 'bot'}):`,
      c.body.slice(0, 1500),
      '',
      `ORIGINAL CODE (file: ${c.path}, line ~${line}):`,
      original ?? '(unavailable)',
      '',
      'CURRENT CODE AT HEAD:',
      current ?? '(line no longer present)',
      '',
      'Has the concern been addressed in the current code?',
      'Respond ONLY as JSON: {"verdict": "YES" | "NO" | "UNCLEAR", "reason": "<one sentence>"}',
      'YES means the concern is clearly resolved by the current code.',
      'NO means the concern is clearly still present.',
      'UNCLEAR means insufficient information to decide; default to this when unsure.',
    ].join('\n')

    try {
      const res = await client.messages.create({
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = res.content.find((b) => b.type === 'text')
      if (!text || text.type !== 'text') {
        return { kind: 'unclear', reason: 'empty response' }
      }
      const clean = text.text.replace(/```(?:json)?|```/g, '').trim()
      const parsed = ResponseSchema.parse(JSON.parse(clean))

      if (parsed.verdict === 'YES') return { kind: 'addressed', reason: parsed.reason }
      if (parsed.verdict === 'NO') return { kind: 'not-addressed', reason: parsed.reason }
      return { kind: 'unclear', reason: parsed.reason }
    } catch (err) {
      return { kind: 'unclear', reason: `classifier error: ${(err as Error).message}` }
    }
  }
}
```

### `src/index.ts`

Orchestration. Keeps the resolve action's main behavior compact.

```ts
import * as core from '@actions/core'
import * as github from '@actions/github'
import { loadConfig } from './config.js'
import { createGit } from './git.js'
import { createGitHubClient } from './github.js'
import { runGates } from './gates.js'
import { createClassifier } from './classifier.js'
import type { ThreadDecision } from './types.js'

async function run(): Promise<void> {
  const cfg = loadConfig()
  const ctx = github.context

  if (ctx.eventName !== 'pull_request' && ctx.eventName !== 'workflow_dispatch') {
    core.warning(`Unsupported event: ${ctx.eventName}. Exiting.`)
    return
  }
  const prPayload = ctx.payload.pull_request
  if (!prPayload) {
    core.warning('No pull_request in payload. Exiting.')
    return
  }
  // Fork PRs: skip for safety.
  if (prPayload.head.repo.full_name !== prPayload.base.repo.full_name) {
    core.info('Fork PR detected; skipping for safety.')
    return
  }

  const pr = {
    owner: ctx.repo.owner,
    repo: ctx.repo.repo,
    number: prPayload.number,
    headSha: prPayload.head.sha,
  }

  const gh = createGitHubClient(cfg.githubToken)
  const git = createGit()
  const classify = createClassifier(cfg.anthropicApiKey, cfg.model)

  const threads = await gh.fetchReviewThreads(pr)
  core.info(`Fetched ${threads.length} review threads`)

  const gateCtx = {
    pr,
    botLogins: new Set(cfg.botLogins),
    generatedGlobs: cfg.generatedFileGlobs,
    git,
  }

  const decisions: ThreadDecision[] = []
  for (const thread of threads) {
    const gateVerdict = await runGates(thread, gateCtx)
    if (gateVerdict.kind === 'needs-classification') {
      const classification = await classify(thread, { pr, git })
      decisions.push({ thread, verdict: { source: 'classifier', classification } })
    } else {
      decisions.push({ thread, verdict: { source: 'gate', gate: gateVerdict } })
    }
  }

  let resolved = 0
  let skipped = 0
  let classified = 0
  for (const d of decisions) {
    const shouldResolve =
      (d.verdict.source === 'gate' && d.verdict.gate.kind === 'auto-resolve') ||
      (d.verdict.source === 'classifier' && d.verdict.classification.kind === 'addressed')
    if (d.verdict.source === 'classifier') classified++

    if (!shouldResolve) {
      skipped++
      continue
    }
    if (resolved >= cfg.maxResolutionsPerRun) {
      core.warning(`Hit max-resolutions-per-run cap (${cfg.maxResolutionsPerRun}); stopping.`)
      break
    }
    if (cfg.dryRun) {
      core.info(`[dry-run] would resolve ${d.thread.id}`)
    } else {
      await gh.resolveReviewThread(d.thread.id)
      core.info(`Resolved ${d.thread.id}`)
    }
    resolved++
  }

  core.setOutput('resolved-count', resolved)
  core.setOutput('skipped-count', skipped)
  core.setOutput('classified-count', classified)

  core.summary
    .addHeading('autoresolve-bot-threads')
    .addRaw(`Dry run: ${cfg.dryRun ? 'yes' : 'no'}\n`)
    .addRaw(`Threads fetched: ${threads.length}\n`)
    .addRaw(`Resolved: ${resolved} · Skipped: ${skipped} · Classified: ${classified}\n`)
    .write()
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err))
})
```

### `src/__tests__/gates.test.ts`

Minimal but covers each gate's happy path. See [this companion section below](#appendix-test-stubs) for full stubs.

---

## 8. Canonical references (verified syntax)

The implementing agent must not improvise these. Match exactly.

### GitHub GraphQL: fetching review threads

Field path: `repository.pullRequest.reviewThreads`. Each `PullRequestReviewThread` exposes `isResolved`, `isOutdated`, and a `comments` connection. On each `PullRequestReviewComment`, `originalCommit`, `line`, and `originalLine` are the fields used by the gates. See the query in `src/github.ts` above.

### GitHub GraphQL: resolving a thread

```graphql
mutation ($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}
```

### GitHub Actions: consumer workflow permissions

The default `GITHUB_TOKEN` needs:

```yaml
permissions:
  pull-requests: write   # resolveReviewThread
  contents: read         # actions/checkout
```

Note: community threads suggest some GitHub App integrations need `contents: write` for `resolveReviewThread`. The default `GITHUB_TOKEN` in Actions has broader scope and `pull-requests: write` is expected to be sufficient. If the mutation returns `Resource not accessible by integration`, escalate `contents` to `write` and re-test.

### Anthropic SDK: messages.create

SDK version `^0.90.0`. Usage pattern used by the classifier:

```ts
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ apiKey })
const res = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 200,
  messages: [{ role: 'user', content: '...' }],
})
const text = res.content.find((b) => b.type === 'text')
```

### Example consumer workflow (ships in README)

```yaml
# .github/workflows/autoresolve-bot-threads.yml
name: Auto-resolve bot review threads

on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:

permissions:
  pull-requests: write
  contents: read

concurrency:
  group: autoresolve-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  autoresolve:
    runs-on: ubuntu-latest
    # Skip forks to avoid secret exposure
    if: github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # needed so originalCommit SHAs are present locally

      - uses: odysseustech/autoresolve-bot-threads@v0.1.0
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          dry-run: 'true'
```

---

## 9. Testing strategy

The gates module is the only one that earns real test coverage in the PoC. Gate mistakes could silently resolve human feedback, which is the single worst failure mode.

**Unit tests (required):**
- Each of the 7 gates, happy path.
- Gate chain falls through to `needs-classification` when no gate matches.
- `extractSuggestionBlock` is deferred along with the gate.

**Skip for PoC:**
- End-to-end mocked octokit test.
- Classifier prompt snapshot.
- Config parser exhaustive cases (one happy + one failure is fine).

**Manual smoke test (required before first tag):**
- Dry-run against a real PR on a private test repo with at least one addressed and one unaddressed bot thread.
- Verify log output matches expected gate/classifier verdicts.

---

## 10. Acceptance criteria for v0.1.0

1. Repo is public at `odysseustech/autoresolve-bot-threads`.
2. `pnpm check` (typecheck + biome + vitest) passes in CI.
3. `dist/index.js` is committed and up to date (CI validates this via diff).
4. The example workflow in `README.md` runs end-to-end against a real PR with dry-run on, logging decisions without error.
5. With dry-run off, the action correctly resolves a known-addressed thread and leaves a known-unaddressed one alone, manually verified on one test PR.
6. Action output counts match the log summary.

---

## 11. Known risks and uncertainties

**Cursor/Bugbot login string.** The default allowlist includes `cursor[bot]`, which is the conventional pattern but unverified for this specific integration. After the first dry-run against a real PR with a Cursor comment, confirm the actual login string (check the `author.login` in logs) and update the default if needed.

**`contents: read` vs `write` for `GITHUB_TOKEN`.** Flagged above. Start with `read`, escalate if the mutation fails.

**`fetch-depth: 0` requirement.** If the consumer forgets this in their `actions/checkout` step, `git show <originalCommit>:<path>` will fail and `gateLineUnchanged` will never fire (it returns `null`, which is correct behavior but reduces the gate's effectiveness). README must make this requirement prominent.

**Fork PRs.** The orchestrator skips them by comparing `head.repo.full_name` to `base.repo.full_name`. This matches the security guidance: fork PRs should never run this action because they could inject crafted bot comments to manipulate the classifier. Do not remove this check.

**Classifier false positives.** The prompt biases toward `UNCLEAR` for ambiguous cases. Do not relax this. A false `YES` that resolves an unaddressed concern is strictly worse than an `UNCLEAR` that leaves a resolved concern open.

---

## 12. Out of scope for v0.1.0 (v0.2+ backlog)

- Tier-0 `suggestion` block matching (auto-resolve when CodeRabbit/Copilot's suggested fix appears at HEAD).
- Batched classifier calls (pack 5-10 threads per call).
- Audit comments posted under a dedicated bot identity before resolve.
- `pull_request_review_comment` trigger with debounce.
- Idempotency marker (label or hidden comment) keyed on HEAD SHA to skip no-op re-runs.
- Human-replied-in-thread gate.
- Per-bot classifier bias (different prompts or thresholds for CodeRabbit vs Greptile).

---

## Appendix: test stubs

```ts
// src/__tests__/gates.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runGates } from '../gates.js'
import type { FileAccess } from '../git.js'
import type { PullRequestContext, ReviewThread } from '../types.js'

const pr: PullRequestContext = {
  owner: 'odysseustech',
  repo: 'test',
  number: 1,
  headSha: 'head',
}

const mkGit = (overrides: Partial<FileAccess> = {}): FileAccess => ({
  fileExistsAtRef: vi.fn().mockResolvedValue(true),
  readFileAtRef: vi.fn().mockResolvedValue('content'),
  readLineWindow: vi.fn().mockResolvedValue('line'),
  ...overrides,
})

const mkThread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  id: 't1',
  isResolved: false,
  isOutdated: false,
  comments: [{
    id: 'c1',
    databaseId: 1,
    author: { login: 'coderabbitai[bot]' },
    body: 'issue',
    path: 'src/a.ts',
    line: 10,
    originalLine: 10,
    originalCommit: { oid: 'orig' },
    createdAt: '2026-04-20T00:00:00Z',
    url: 'https://...',
  }],
  ...overrides,
})

const ctx = {
  pr,
  botLogins: new Set(['coderabbitai[bot]']),
  generatedGlobs: ['**/generated/**'],
  git: mkGit(),
}

describe('gates', () => {
  it('skips resolved threads', async () => {
    expect(await runGates(mkThread({ isResolved: true }), ctx))
      .toEqual({ kind: 'skip', reason: 'already-resolved' })
  })

  it('auto-resolves outdated threads', async () => {
    expect(await runGates(mkThread({ isOutdated: true }), ctx))
      .toEqual({ kind: 'auto-resolve', reason: 'all-comments-outdated' })
  })

  it('skips non-bot authors', async () => {
    const t = mkThread()
    t.comments[0]!.author = { login: 'fenix' }
    expect(await runGates(t, ctx))
      .toEqual({ kind: 'skip', reason: 'non-bot-author' })
  })

  it('auto-resolves generated files', async () => {
    const t = mkThread()
    t.comments[0]!.path = 'src/generated/types.ts'
    expect(await runGates(t, ctx))
      .toEqual({ kind: 'auto-resolve', reason: 'generated-file' })
  })

  it('auto-resolves when file deleted', async () => {
    const customCtx = { ...ctx, git: mkGit({ fileExistsAtRef: vi.fn().mockResolvedValue(false) }) }
    expect(await runGates(mkThread(), customCtx))
      .toEqual({ kind: 'auto-resolve', reason: 'file-deleted-at-head' })
  })

  it('skips when line unchanged', async () => {
    const customCtx = { ...ctx, git: mkGit({ readLineWindow: vi.fn().mockResolvedValue('same') }) }
    expect(await runGates(mkThread(), customCtx))
      .toEqual({ kind: 'skip', reason: 'line-unchanged-at-head' })
  })

  it('falls through to classification when all gates pass', async () => {
    const customCtx = {
      ...ctx,
      git: mkGit({
        readLineWindow: vi.fn()
          .mockResolvedValueOnce('original line')
          .mockResolvedValueOnce('changed line'),
      }),
    }
    expect(await runGates(mkThread(), customCtx))
      .toEqual({ kind: 'needs-classification' })
  })
})
```

---

## Handoff notes for the implementing agent

- Work phase by phase. Do not skip ahead. Each phase ends in green tests + a commit.
- Use Biome for format on save. Double quotes, semicolons, 2-space indent, 100ch line width.
- Do not add dependencies not listed in section 4. If you think you need one, stop and ask.
- If the canonical syntax in section 8 conflicts with what you find in your own training, trust section 8. It was verified for this plan.
- Before the first real run, the manual smoke test in section 9 is mandatory.
- Dry-run default is a safety feature, not a convenience toggle. Do not change the default.