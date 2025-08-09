## Table of Contents

1. [Overview](#overview)
2. [Goals](#goals)
3. [Workflow Steps](#workflow-steps)

   - [1. Pre-PR Checklist](#1-pre-pr-checklist)
   - [2. Review PR on GitHub](#2-review-pr-on-github)
   - [3. Pull PR Locally (Ephemeral Branch)](#3-pull-pr-locally-ephemeral-branch)
   - [4. Local Testing](#4-local-testing)
   - [5. Final Review & Merge](#6-final-review--merge)
   - [6. Clean Up Local Branch](#5-clean-up-local-branch)
   - [7. Verify CI/CD Post-Merge](#7-verify-cicd-post-merge)

4. [Optional Automation](#optional-automation)
5. [Summary Flow](#summary-flow)

---

## Overview

- **Tech Stack**: Remix, TailwindCSS, TypeScript
- **Repository**: GitHub (Pull Requests)
- **CI/CD**: GitHub Actions builds Docker → GHCR

---

## Goals

1. Ensure code quality & functionality
2. Automate repetitive steps
3. Keep local repo clean
4. Streamline review process
5. Maintain secure, traceable `master` history

---

## Workflow Steps

### 1. Pre-PR Checklist

Before diving into the review, confirm the PR author has:

- Linked the PR to an issue (if applicable)
- Provided a clear description
- Added test coverage or testing notes
- Ensured CI checks (lint, typecheck, build) pass

### 2. Review PR on GitHub

On the GitHub website:

1. Read PR title & description
2. Check linked issues and discussion
3. Verify CI status (✅ lint, typecheck, build)
4. Perform initial code review:

   - Architecture & file structure
   - Naming conventions
   - High-level logic and patterns

5. Add inline comments via **Files Changed** if needed

### 3. Pull PR Locally (Ephemeral Branch)

Use GitHub CLI for a one-step checkout:

```bash
gh pr checkout <pr-number>
```

_Alternative manual approach:_

```bash
git fetch origin pull/<pr-number>/head && \
  git checkout -b temp-pr-<pr-number> FETCH_HEAD
```

This creates a temporary local branch for in-depth review.

### 4. Local Testing

In VS Code terminal:

```bash
# Lint
npm run lint

# Type-check
npm run typecheck

# Start dev server
npm run dev
```

- Manually verify UI/UX in the browser
- Test features and edge cases
- Use responsive modes in DevTools if relevant

### 5. Final Review & Merge

On GitHub:

1. Resolve any outstanding comments
2. Approve the PR
3. Choose **Squash and Merge**:

   - Single commit per PR
   - Keep commit messages consistent: e.g., `feat(auth): magic link login`

### 6. Clean Up Local Branch

After review:

```bash
# Switch back to main
git checkout main

# Delete temporary branch
git branch -D temp-pr-<pr-number>

# Prune merged remotes
git remote prune origin
```

### 7. Verify CI/CD Post-Merge

1. Monitor GitHub Actions for Docker build & GHCR push
2. Optionally pull and run the image locally:

```bash
docker pull ghcr.io/<org>/<app>:latest

docker run -p 3000:3000 ghcr.io/<org>/<app>:latest
```

---

## Optional Automation

### GitHub Actions PR Validation

Automate: lint, typecheck, unit tests, build in PR workflow.

### Local Cleanup Aliases

Add to shell config:

```bash
# Delete merged PR branches
git branch --merged main | grep 'temp-pr' | xargs git branch -d

# Prune remote-stale
git remote prune origin
```

---

## Summary Flow

```text
1. PR opened on GitHub
2. Initial review & CI check
3. `gh pr checkout <#>` → local review & test
4. Clean temp branch
5. Approve & Squash and Merge
6. CI/CD builds Docker image → GHCR
7. Monitor & verify deployment
```
