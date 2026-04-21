# autoresolve-pr-threads

> GitHub Action that auto-resolves addressed bot PR review threads via a deterministic gate chain + Claude Haiku 4.5.

When a bot (CodeRabbit, Greptile, Copilot, Cursor) leaves a review comment and a human addresses the feedback, this action detects that and resolves the thread — so your unresolved-conversations count reflects real work left, not stale bot noise.

**Dry-run by default.** The action logs decisions without touching anything until you explicitly set `dry-run: 'false'`.

---

## Quickstart

Add this workflow to your repo:

```yaml
# .github/workflows/autoresolve-pr-threads.yml
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
          fetch-depth: 0   # required — see note below

      - uses: odysseustech/autoresolve-pr-threads@v0.1.0
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          dry-run: 'true'
```

> **`fetch-depth: 0` is required.** The action uses `git show <originalCommit>:<path>` to compare line content at the time of the comment vs. HEAD. A shallow clone will cause `gateLineUnchanged` to silently skip, reducing gate effectiveness.

---

## How it works

For each open review thread on the PR:

1. **Deterministic gate chain** (no API cost) — short-circuits obvious cases:
   - Already resolved → skip
   - All comments outdated → auto-resolve
   - Author not in bot allowlist → skip
   - No line anchor → skip
   - Path matches generated-file glob → auto-resolve
   - File deleted at HEAD → auto-resolve
   - Commented line unchanged since comment was posted → skip (concern still present)

2. **Claude Haiku 4.5 classifier** — for threads that pass all gates, asks a single yes/no question: *is this concern still present in the current code?* Conservative bias: defaults to `UNCLEAR` when uncertain.

3. **Apply decisions** — respects `dry-run` and `max-resolutions-per-run` cap.

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `anthropic-api-key` | Yes | — | Anthropic API key for the Haiku classifier |
| `github-token` | No | `${{ github.token }}` | Token with `pull-requests:write` and `contents:read` |
| `dry-run` | No | `'true'` | Log decisions without resolving anything |
| `bot-logins` | No | `coderabbitai[bot],...` | Comma-separated bot login allowlist |
| `model` | No | `claude-haiku-4-5-20251001` | Anthropic model ID |
| `max-resolutions-per-run` | No | `20` | Hard cap on resolutions per run |
| `generated-file-globs` | No | `**/generated/**,...` | Comma-separated globs for generated files |

## Outputs

| Output | Description |
|---|---|
| `resolved-count` | Threads resolved this run |
| `skipped-count` | Threads skipped |
| `classified-count` | Threads that reached the AI classifier |

---

## Permissions

```yaml
permissions:
  pull-requests: write   # resolveReviewThread mutation
  contents: read         # actions/checkout + git show
```

If the mutation returns `Resource not accessible by integration`, try escalating `contents` to `write`.

---

## Target bots

Default allowlist: `coderabbitai[bot]`, `greptile-apps[bot]`, `copilot-pull-request-reviewer[bot]`, `cursor[bot]`.

Override with the `bot-logins` input. Check `author.login` in dry-run logs to confirm the exact login string for any bot not listed here.

---

## Safety notes

- **Fork PRs are always skipped** — prevents crafted bot comments from manipulating the classifier.
- **Dry-run default is intentional** — flip to `false` only after verifying decisions in logs.
- **Classifier biases toward `UNCLEAR`** — a false positive that resolves an unaddressed concern is strictly worse than leaving a resolved one open.