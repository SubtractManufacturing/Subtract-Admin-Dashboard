# PR Code Review (PR-Agent + OpenAI)

Automated pull request review runs via [PR-Agent](https://github.com/qodo-ai/pr-agent) in GitHub Actions. It posts a review comment on new PRs and responds to slash commands in PR comments.

For domain context the reviewer sees, see [CONTEXT.md](../CONTEXT.md) and [CLAUDE.md](../CLAUDE.md).

## Quick reference

| Item | Value |
|------|-------|
| **Tool** | [PR-Agent](https://github.com/qodo-ai/pr-agent) (`the-pr-agent/pr-agent` GitHub Action) |
| **Workflow** | [`.github/workflows/pr-agent.yml`](../.github/workflows/pr-agent.yml) |
| **Repo config** | [`.pr_agent.toml`](../.pr_agent.toml) |
| **Action version** | `v0.39.0` (pinned — do not use `@main` in production) |
| **Model** | `gpt-5.4-mini` |
| **API key secret** | `OPENAI_KEY` (GitHub repo secret) |
| **Auto on PR open** | `/review` only |
| **Manual commands** | `/review`, `/describe`, `/improve`, `/ask` in PR comments |

## What runs automatically

On **PR opened**, **reopened**, or marked **ready for review**:

- **Review** (`/review`) — security, tests, effort estimate, findings (up to 3)

**Not** auto-run (cost control):

- **Describe** (`/describe`) — we use the PR template instead
- **Improve** (`/improve`) — run manually when you want code suggestions

**Not** triggered on every push (`synchronize`). After pushing fixes, comment `/review` to re-run.

Draft PRs do not run until marked **Ready for review**.

## How to trigger manually

Comment on the PR:

```
/review
/describe
/improve
/ask What does the carrier detection logic do?
```

Bot-authored comments are ignored by the workflow.

## OpenAI model and pricing

We use **`gpt-5.4-mini`** instead of PR-Agent's default `gpt-5.5-2026-04-23`. Mini is sufficient for PR review and much cheaper.

**Approximate Standard API pricing (July 2026, per 1M tokens):**

| Model | Input | Cached input | Output | Notes |
|-------|-------|--------------|--------|-------|
| **gpt-5.4-mini** (ours) | $0.75 | $0.075 | $4.50 | 400K context |
| gpt-5.5 (previous default) | $5.00 | $0.50 | $30.00 | 1M context |

Verify current rates on the official page: [OpenAI API pricing](https://openai.com/api/pricing/).

### Rough cost per PR review

PR-Agent sends the PR diff (clipped to 32K tokens) plus prompts. A single `/review` on a medium feature PR is often **~$0.01–0.05** on mini, depending on diff size and output length.

**Previous setup cost drivers** (now disabled):

- Running describe + review + improve on **every push** (3 tools × N pushes)
- Using **gpt-5.5** (~6.7× more expensive on input vs mini)
- Large **drizzle/meta/*_snapshot.json** files inflating token counts (now skipped via config)

### Monitor spend

1. [OpenAI Usage dashboard](https://platform.openai.com/usage) — filter by API key / project
2. GitHub Actions logs — search for `Generating prediction with` and `Tokens:` (see below)

## How to find the active model

### In repo config

```toml
# .pr_agent.toml
[config]
model = "gpt-5.4-mini"
```

Workflow env vars in `.github/workflows/pr-agent.yml` also set `config.model` (they override defaults at runtime; `.pr_agent.toml` is merged per PR-Agent precedence rules).

### In a GitHub Actions run

1. Open **Actions** → **PR Agent** → pick a run
2. Expand **Run PR Agent on open/reopen…**
3. Search logs for:
   - `"model": "gpt-5.4-mini"` inside `Relevant configs`
   - `Generating prediction with gpt-5.4-mini`

Example:

```bash
gh run list --workflow=pr-agent.yml --limit 5
gh run view <run-id> --log | grep -E "Generating prediction|Tokens:"
```

## How to change behavior

Configuration layers (highest wins last for overlapping keys):

1. PR-Agent built-in defaults
2. Org repo `SubtractManufacturing/pr-agent-settings` (not set up)
3. Repo [`.pr_agent.toml`](../.pr_agent.toml) on default branch
4. Workflow `env:` overrides in [`.github/workflows/pr-agent.yml`](../.github/workflows/pr-agent.yml)

### Common changes

| Goal | Where | What to change |
|------|-------|----------------|
| Change model | `.pr_agent.toml` or workflow `env` | `config.model = "gpt-5.4"` or `"gpt-5.5-2026-04-23"` |
| Re-enable auto-describe | workflow `env` | `github_action_config.auto_describe: "true"` |
| Re-enable auto-improve | workflow `env` | `github_action_config.auto_improve: "true"` |
| Review on every push | workflow | Add `"synchronize"` to `on.pull_request.types` and `github_action_config.pr_actions` |
| Skip release-please PRs | `.pr_agent.toml` | `ignore_pr_title` (already includes `^chore\(.*\): release`) |
| Project-specific review rules | `.pr_agent.toml` | `[pr_reviewer].extra_instructions` |
| Inject domain docs into prompts | `.pr_agent.toml` | `repo_context_files` |
| Pin / upgrade PR-Agent | workflow | `uses: the-pr-agent/pr-agent@vX.Y.Z` |

After changing `.pr_agent.toml`, merge to the default branch — PR-Agent reads it from there.

### Upgrade PR-Agent version

1. Check [releases](https://github.com/qodo-ai/pr-agent/releases)
2. Update the tag in `.github/workflows/pr-agent.yml`
3. Run on a test PR; check logs for config/model changes

## Configuration files in this repo

```
.github/workflows/pr-agent.yml   # Triggers, secrets, auto_* toggles, model env overrides
.pr_agent.toml                   # Model, context files, review instructions, ignore rules
```

## Secrets

| Secret | Purpose |
|--------|---------|
| `OPENAI_KEY` | OpenAI API key for PR-Agent |
| `GITHUB_TOKEN` | Provided automatically; posts comments and updates PRs |

Manage secrets: **GitHub repo → Settings → Secrets and variables → Actions**.

## PR-Agent documentation

| Topic | URL |
|-------|-----|
| Main repo | https://github.com/qodo-ai/pr-agent |
| GitHub Action install | https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/installation/github.md |
| Configuration options | https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/usage-guide/configuration_options.md |
| Changing models | https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/usage-guide/changing_a_model.md |
| Full default config | https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/configuration.toml |
| Tool: `/review` | https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/tools/review.md |
| Tool: `/improve` | https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/tools/improve.md |
| Tool: `/describe` | https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/tools/describe.md |

Upstream project was formerly known as **Qodo PR-Agent** / **Codium PR-Agent**. The GitHub org is `the-pr-agent`; source also lives under `qodo-ai`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No review comment | Draft PR | Mark ready for review |
| Workflow skipped | Bot comment | Comment as a human user |
| `model not found` | Wrong model id | Check [OpenAI models](https://platform.openai.com/docs/models) and `.pr_agent.toml` |
| Empty / shallow review | Diff pruned (>32K tokens) | Split PR; exclude large generated files |
| High OpenAI bill | Re-enabled auto tools or gpt-5.5 | Restore settings in this doc's quick reference |
| Action behavior changed | Using `@main` | Pin to a release tag |

## History / rationale (July 2026)

Tuned for cost without losing useful review signal:

- Pinned action to `v0.39.0`
- Downgraded model from default `gpt-5.5` → `gpt-5.4-mini`
- Auto **review only** on open/reopen/ready (not every push)
- Disabled auto describe/improve
- Added `CONTEXT.md` + `CLAUDE.md` as repo context
- Skip `.json` patches (Drizzle snapshots) and release-please PR titles
- Concurrency cancels stale runs on rapid re-triggers
