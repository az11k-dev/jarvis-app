---
name: second-opinion
description: Get two cheap independent reviews of the current diff (or a plan/file) from agy (Gemini) and codex (GPT) in parallel, read-only, then verify each finding before reporting. Use before committing a non-trivial change or when the user wants another opinion.
argument-hint: '[what to review — default: uncommitted diff]'
---

# Second opinion from agy + codex

Target: `$ARGUMENTS` (default: `git diff HEAD` — uncommitted changes, staged and unstaged).

1. Save the diff and context to the scratchpad:

   ```sh
   git diff HEAD > "$SCRATCH/review.diff"; git status --short > "$SCRATCH/status.txt"
   ```

   If the diff is empty, say so and stop.

2. Launch both **in one message, both with `run_in_background: true`** (each takes 3–8 min):

   ```sh
   agy --output-format json --model gemini-3.8-flash-high --agent code-reviewer --print-timeout 9m \
     -p "Review the diff in $SCRATCH/review.diff for the jarvis-app repo (cwd). Read AGENTS.md and the touched files first. Read-only, deliver as plain-text reply." \
     > "$SCRATCH/agy-review.json"
   ```

   ```sh
   codex exec -m gpt-6-luna -s read-only -o "$SCRATCH/codex-review.md" \
     "You are reviewing jarvis-app. Read AGENTS.md, then review the diff in $SCRATCH/review.diff, reading the touched files for context. Read-only: do not create, edit or delete files. Report only verified issues as numbered findings: file:line — severity (bug|risk|nit) — problem — failure scenario — fix. Max 350 words." \
     > /dev/null 2>&1
   ```

   (`-p` must be agy's last flag.) Keep working while they run.

3. When both finish: read `.response` from the agy JSON (`jq -r .response`; if `error`/`finished_reason`
   is set the run failed) and the codex file.
4. **Verify every finding yourself** in the code. Past runs had ~40 % false positives (missing tests
   that existed elsewhere, library behavior misread).
5. `git status --short` must match `$SCRATCH/status.txt` — reviewers must not have written files.
6. Report: a table of findings → source (agy/codex/both) → **confirmed / rejected (why)**, then the
   fixes you propose. Don't apply fixes unless the user asked for them.
