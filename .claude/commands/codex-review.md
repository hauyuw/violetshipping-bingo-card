---
description: Reviews code changes from 3 parallel Codex (GPT-5.4) reviewers for bugs, CLAUDE.md compliance, and code quality
argument-hint: "[file or directory paths to review]"
---

# Codex Code Review

Reviews local code changes from 3 independent Codex (GPT-5.4) perspectives: bug detection,
CLAUDE.md compliance, and code quality/patterns. First classifies changed files to skip
non-code edits (plans, docs, skill definitions, metadata). For code changes, aggregates
findings, deduplicates, and auto-fixes issues with confidence >= 80.

## Gathering Changed Files

Determine which files to review, in priority order:

1. **Explicit arguments**: If `$ARGUMENTS` is non-empty, use those paths as the files to review.
   - If a path is a directory, find all source files in it recursively
   - If a path is a file, use it directly
   - Validate that all paths exist; warn about any that don't
2. **Git diff fallback**: If no arguments were provided:
   - Check if in a git repo (`git rev-parse --is-inside-work-tree`)
   - If yes: use `git diff HEAD` to get changed files. If HEAD has no changes, try `git diff HEAD~1`
   - If not a git repo: ask the user which files to review

If no changed files are found by any method, tell the user "No changes detected to review" and stop.

## Classification Gate

**After gathering the file list but before any other processing**, look at the changed file paths and determine if the session's work involved writing or modifying code.

**Proceed with review** if the changed files include:
- Source code files (`.py`, `.js`, `.ts`, `.tsx`, `.jsx`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.rb`, `.php`, `.swift`, `.kt`, `.sh`, `.bash`, `.sql`, `.html`, `.css`, `.scss`, `.vue`, `.svelte`, etc.)
- Shell scripts or hook scripts that contain program logic
- Infrastructure-as-code (Dockerfile, Terraform, CI/CD workflow configs)
- Build configs that affect runtime behavior (`webpack.config.*`, `vite.config.*`, `jest.config.*`, `tsconfig.json`)
- Dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`)

**Skip review** if ALL changed files are:
- Plan documents (`.claude/plans/*.md`)
- Skill definition files (`SKILL.md` — markdown instructions for Claude, not executable code)
- Documentation (README, CHANGELOG, CONTRIBUTING, LICENSE, CLAUDE.md, AGENTS.md, USAGE.md)
- Eval/test fixture metadata (`evals.json` with only name/description changes)
- Memory files (`.claude/memory/*.md`)
- Lock files (`uv.lock`, `package-lock.json`, `yarn.lock`, etc.)
- Binary/media files (images, fonts)
- Generic markdown that isn't source code

If the file list is mixed (some code, some non-code), **proceed with review** — the code changes warrant it even if the non-code changes don't.

If ambiguous (e.g., a `.json` or `.yaml` file that might contain executable logic), **err on the side of running the review**.

### Skip Behavior

If all changed files are non-code, tell the user: "The changed files appear to be non-code. Run review anyway?" If user confirms, proceed. If user declines, stop.

## Trivial Change Filter

Read the actual diff content (or file contents for non-git). If the total meaningful changes are fewer than 5 lines (excluding whitespace-only and comment-only changes), tell the user "Changes are trivial (< 5 lines) — skipping review" and stop.

## Large Diff Handling

If the total diff exceeds 50,000 characters:
- Sort files by diff size (largest first)
- Include only the top 15 files
- Note to the user which files were truncated

## Building Review Context

Before spawning reviewers, gather project context (spend ~15 seconds):

- Project name/description (from package.json, pyproject.toml, Cargo.toml, README, etc.)
- Primary language and framework
- Top-level directory structure (`ls` the project root)
- Read the changed files in full so you can include their content in prompts

Also check if a CLAUDE.md file exists in the project root or any parent directory. If found, read it — Reviewer 2 needs it. If no CLAUDE.md exists, skip Reviewer 2 entirely.

Format as:
```text
PROJECT CONTEXT:
Name: [project name]
Language: [primary language/framework]
Structure: [key directories, one line]
```

## Spawning 3 Parallel Codex Reviewers

Launch all reviewer sessions **simultaneously** using `mcp__codex__codex`. Make all tool calls
in a single turn so they run in parallel.

### Codex Configuration

Use these settings for every reviewer call:

```text
model: "gpt-5.4"
sandbox: "workspace-write"
cwd: [project root directory]
approval-policy: "on-failure"
config: {
  "model_reasoning_effort": "xhigh",
  "sandbox_workspace_write": {"network_access": true}
}
```

Note: The `model` parameter can be omitted to use the default from `~/.codex/config.toml`.

### Reviewer 1 — Bug Detection

**developer-instructions**:
```text
You are a senior software engineer with 15+ years of experience hunting bugs in production code.
Your job is to find logic errors, null/undefined access, race conditions, error handling gaps,
and edge cases in recently changed code.

Ground every finding in actual code you read. Don't invent hypothetical concerns. Don't nitpick
style or naming. Focus on things that would cause real problems in production: crashes, data
corruption, security holes, incorrect behavior, silent failures.
```

**prompt**:
```text
Review the following code changes for bugs. Read each changed file IN FULL to understand the
surrounding context, not just the changed lines.

PROJECT CONTEXT:
[context block]

CHANGED FILES:
[list of file paths]

DIFF / CHANGES:
[diff content or file contents]

For each issue found, output:
- **Issue**: One-line summary
- **File**: File path and line number(s)
- **Severity**: critical | important | minor
- **Confidence**: 0-100 score (how confident you are this is a real bug, not a false positive)
- **Why it matters**: 1-2 sentences on the real-world impact
- **Suggested fix**: A concrete code change (not vague advice)

If the code looks solid, say so — don't manufacture issues to justify your existence.
```

### Reviewer 2 — CLAUDE.md Compliance

**Skip this reviewer entirely if no CLAUDE.md file exists.**

**developer-instructions**:
```text
You are a senior software engineer specializing in codebase standards compliance. Your job is
to check that code changes follow the project's CLAUDE.md guidelines. You must quote the
specific guideline being violated — vague references are not acceptable.

Only flag issues that are directly and specifically called out in the CLAUDE.md. Do not flag
general best practices unless the CLAUDE.md explicitly mentions them. If the CLAUDE.md says
"use snake_case for variables" and the code uses camelCase, that's a finding. If the CLAUDE.md
doesn't mention naming conventions, don't flag naming issues.
```

**prompt**:
```text
Check these code changes against the project's CLAUDE.md guidelines.

PROJECT CONTEXT:
[context block]

CLAUDE.MD CONTENTS:
[full CLAUDE.md content]

CHANGED FILES:
[list of file paths]

DIFF / CHANGES:
[diff content or file contents]

For each violation found, output:
- **Issue**: One-line summary
- **File**: File path and line number(s)
- **Guideline violated**: Quote the exact CLAUDE.md text
- **Confidence**: 0-100 score
- **Suggested fix**: A concrete code change to comply

If the changes comply with all CLAUDE.md guidelines, say so explicitly.
```

### Reviewer 3 — Code Quality & Patterns

**developer-instructions**:
```text
You are a senior software engineer focused on code quality and consistency. Your job is to
check that new code is consistent with existing codebase patterns, has appropriate error
handling, uses the right level of abstraction, and validates input at trust boundaries.

BEFORE REVIEWING: Read surrounding code in the same files and related files to understand
established patterns. Your findings must be grounded in actual inconsistencies with the
existing codebase, not abstract best practices.
```

**prompt**:
```text
Review these code changes for consistency with existing codebase patterns and code quality.
Read surrounding code to understand established conventions before critiquing.

PROJECT CONTEXT:
[context block]

CHANGED FILES:
[list of file paths]

DIFF / CHANGES:
[diff content or file contents]

For each issue found, output:
- **Issue**: One-line summary
- **File**: File path and line number(s)
- **Severity**: critical | important | minor
- **Confidence**: 0-100 score
- **Pattern reference**: Point to existing code that demonstrates the expected pattern
- **Suggested fix**: A concrete code change

Focus on:
- Inconsistency with existing patterns in the codebase (naming, error handling style, etc.)
- Missing error handling for likely failure modes
- Wrong level of abstraction (too much or too little for this codebase)
- Input validation at trust boundaries (user input, external APIs, file I/O)
- Resource leaks or cleanup issues

If the code quality is good and consistent with the codebase, say so.
```

## Aggregating Results

After all Codex sessions return (2 or 3, depending on CLAUDE.md existence):

### 1. Parse Each Reviewer's Output

Extract individual issues with their severity, confidence, file references, and suggested fixes.

### 2. Apply Confidence Threshold

Filter out any issues with confidence score below **80**. Issues below this threshold are likely
false positives or nitpicks.

### 3. Deduplicate and Amplify Consensus

If multiple reviewers flagged the same underlying issue (same file, same logical problem):
- Merge into one finding
- Note the consensus ("Flagged by 2 reviewers" / "Flagged by all 3 reviewers")
- Use the highest confidence score from any reviewer
- Consensus issues are higher signal — present them first

### 4. Filter Noise

Remove issues that are:
- Pure style preferences with no functional impact
- Hypothetical concerns that don't apply at this project's actual scale
- Things a linter or type checker would catch
- Pre-existing issues not introduced by the current changes

### 5. Categorize

Sort remaining issues into:
- **Must Address** (confidence >= 90): Critical issues that would cause real problems
- **Should Consider** (confidence 80-89): Valid improvements worth the user's attention
- **Noted** (below threshold but caught by multiple reviewers): Tracked for awareness

## Applying Fixes

After aggregating and categorizing results:

### Auto-Fix (confidence >= 80)

For each issue in **Must Address** (confidence >= 90) and **Should Consider** (confidence 80-89):
1. Apply the suggested fix directly to the source file using Edit tool
2. If a suggested fix is too vague or ambiguous to apply safely, skip it and include it in the summary as unfixed

### Summary Output

After applying fixes, present a summary:

```text
### Codex Code Review Results

Reviewed [N] file(s) with [2-3] Codex reviewers.

#### Fixed ([count] issues)
1. **[Issue summary]** — [file:line]
   [What was changed]
   _Confidence: [score] | Source: [Reviewer name(s)]_

#### Could Not Auto-Fix ([count] issues)
1. **[Issue summary]** — [file:line]
   [Why it couldn't be auto-fixed + the suggested fix for manual application]
   _Confidence: [score] | Source: [Reviewer name]_

#### Noted (informational only)
- [Brief issue] — [file:line] _(Confidence: [score])_
```

If no issues survived filtering:
```text
### Codex Code Review Results

Reviewed [N] file(s) with [2-3] Codex reviewers. No significant issues found.
```

## Error Handling

- **Codex session fails**: Present results from whichever reviewers succeeded. Note which
  reviewer(s) failed and why.
- **All sessions fail**: Tell the user "Codex review failed — [error details]. You can retry
  with /codex-review."
- **Not a git repo and no arguments**: Ask the user to specify files to review.

## Important Notes

- This command auto-fixes issues with confidence >= 80 (Must Address + Should Consider).
- Issues that are too vague or ambiguous to fix safely are presented for manual review.
- Noted items (below threshold or low confidence) are informational only.
- When invoked with arguments (`/codex-review <paths>`), those paths are reviewed directly.
- When invoked without arguments, falls back to git diff to find uncommitted changes.
