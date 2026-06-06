Run the full backlog workflow for task $ARGUMENTS.

You are the orchestrator. Execute the steps below in order, calling each one with the Agent tool and `run_in_background: false`. Every call blocks until the agent finishes before you start the next step.

**On agent error**: if any Agent call returns an explicit error (not just short or truncated output), tell the user which step failed with a one-line summary and stop. Do not attempt to recover or do the step yourself.

**You are the orchestrator — never the implementer.** You may not read source files, edit code, run tests, or fix bugs directly. All implementation work (including fixing review issues) must go through a subagent. Your only direct tool calls are: `mcp`, `bash` (grep/awk only — no file editing, no running tests), `git status --short`, and spawning agents.

**Output truncation is normal** for long-running steps like developer and researcher — their output may be cut off. Always verify step completion via grep against the task file, not by reading the agent's output text.

---

## Preamble

Run these steps before spawning any agents:

1. Update task status:
   - mcp backlog_task_edit — id: "$ARGUMENTS", status: "Needs Plan"

2. Read the full task once:
   - mcp backlog_task_view — id: "$ARGUMENTS"

   From the output, extract and record:
   - **TASK_FILE**: the path shown on the "File:" line — use this path for grep checks in the developer loop
   - **AC list**: every acceptance criterion — its number (the integer after `#`) and exact full text (e.g., `#1 Install mt3-infer…`)
   - **HAS_RESEARCH**: true if the notes section contains a `## Research Brief` heading with content beneath it
   - **HAS_PLAN**: true if the plan section is non-empty (any content under a plan heading or between plan markers)

Do not call backlog_task_view again in the orchestrator; subagents read it themselves.

---

## Step 1 — Researcher (skip if HAS_RESEARCH is true)

If HAS_RESEARCH is true (from preamble), proceed directly to Step 2.

Otherwise call the Agent tool with:
- `subagent_type`: `researcher`
- `description`: `Research $ARGUMENTS`
- `prompt`: the text between the `<prompt>` tags below, passed verbatim

<prompt>
Mark the task In Progress:
- backlog_task_edit — id: "$ARGUMENTS", status: "In Progress"

Read the task in full:
- backlog_task_view — id: "$ARGUMENTS"

Research the task. Identify the key unknowns — libraries to evaluate, APIs to understand, implementation patterns to compare. Produce a concise brief covering: recommended approaches with rationale, tradeoffs between options, gotchas, and exact API signatures for any external libraries the developer will call.

When done, write the brief directly into the task file — do NOT use backlog_task_edit notesAppend (it fails on large payloads). The task file path was shown by backlog_task_view on the "File:" line. Run this Python snippet via bash:

```python
task_file = "<path from the 'File:' line>"
brief = "## Research Brief\n\n<your full brief text here>"
with open(task_file, 'r') as f:
    content = f.read()
if '<!-- SECTION:NOTES:END -->' in content:
    content = content.replace('<!-- SECTION:NOTES:END -->', brief + '\n<!-- SECTION:NOTES:END -->')
else:
    content += '\n## Notes\n\n<!-- SECTION:NOTES:BEGIN -->\n' + brief + '\n<!-- SECTION:NOTES:END -->\n'
with open(task_file, 'w') as f:
    f.write(content)
```
</prompt>

---

## Step 2 — Architect (skip if HAS_PLAN is true)

If HAS_PLAN is true (from preamble), extract and present the existing plan to the user:
```bash
awk '/SECTION:PLAN:BEGIN/{p=1;next}/SECTION:PLAN:END/{exit} p' "$TASK_FILE"
```

Otherwise call the Agent tool with:
- `subagent_type`: `architect`
- `description`: `Plan $ARGUMENTS`
- `prompt`: the text between the `<prompt>` tags below, passed verbatim

<prompt>
Plan backlog task $ARGUMENTS.

Read the task in full — the Research Brief is in the notes section:
- backlog_task_view — id: "$ARGUMENTS"

The research brief in the task notes already covers what's in the codebase — do not re-read source files the researcher summarised. Trust the brief.

Draft a concrete implementation plan covering:
- Key files to create or modify (exact paths)
- TDD order (which tests to write first)
- How each acceptance criterion will be met
- Exact library API calls the developer should use (copy from the research brief)
- Any risks or prerequisites

Record the plan and update status:
- backlog_task_edit — id: "$ARGUMENTS", planSet: "<full plan text>"
- backlog_task_edit — id: "$ARGUMENTS", status: "To Do"

Output the full plan text.
</prompt>

**⛔ APPROVAL GATE** — Present the plan to the user and wait for explicit approval before continuing. Do not start Step 3 until the user says to proceed.

---

## Step 3 — Developer (per-AC loop, only after user approval)

Loop through each AC from the list you extracted in the preamble, in order. For each AC #N with text `<ac text>`:

**1. Check if already done:**
```bash
grep -q "^- \[x\] #N " "$TASK_FILE" && echo DONE || echo TODO
```
(Replace `N` with the actual integer.) If DONE, skip to the next AC.

**2. Spawn developer for this AC:**

Call the Agent tool with:
- `subagent_type`: `developer`
- `description`: `Implement $ARGUMENTS AC #N`
- `maxOutput`: `{ lines: 20000 }`
- `prompt`: the text between the `<prompt>` tags below, substituting the actual AC number and text

<prompt>
Implement acceptance criterion #N for backlog task $ARGUMENTS.

The AC you must implement:
  #N <ac text>

Read the task and plan:
- backlog_task_view — id: "$ARGUMENTS"

Mark it in progress:
- backlog_task_edit — id: "$ARGUMENTS", status: "In Progress", assignee: ["developer"]

Work on ONLY this AC:
1. Read the specific source files the plan names for this AC — **at most 3 files total**. Do not grep, glob, or read additional files beyond what the plan names.
2. Write a test for this AC only
3. Run it (never run the full suite — run only the specific test you just wrote):
   ```bash
   uv run python -m pytest <test_file>::<test_class>::<test_method> -x --tb=short
   ```
4. Implement the minimum code to make it pass
5. Run tests again to confirm green
6. Run quality tools:
   ```bash
   uv run ruff check <file> && uv run mypy <file>
   ```
   If mypy reports more than 5 errors, stop and report: "STUCK: mypy errors exceed threshold — <summary>". Do not iterate through type errors in a loop.
7. Check off this AC: backlog_task_edit — id: "$ARGUMENTS", acceptanceCriteriaCheck: [N]

Stop after completing this AC. Do not proceed to other ACs.
</prompt>

**3. Verify completion:**
```bash
grep -q "^- \[x\] #N " "$TASK_FILE" && echo DONE || echo RETRY
```

If RETRY, spawn the developer once more with the continuation prompt below. If it still fails after 2 total attempts, report exactly which AC is stuck and stop.

<prompt>
Retry acceptance criterion #N for backlog task $ARGUMENTS.

The AC you must implement:
  #N <ac text>

Read the current task state:
- backlog_task_view — id: "$ARGUMENTS"

Do not rewrite tests or code that already exist on disk for this AC. Focus on what is missing or broken. Fix it, confirm tests pass (unit tests only — no integration tests), run ruff+mypy, then check off the AC:
- backlog_task_edit — id: "$ARGUMENTS", acceptanceCriteriaCheck: [N]
</prompt>

**After the loop**, confirm no unchecked ACs remain:
```bash
grep -c "^- \[ \]" "$TASK_FILE"
```
Should print `0`. If not, report the remaining unchecked ACs and stop.

---

## Step 4 — Reviewer

Call the Agent tool with:
- `subagent_type`: `reviewer`
- `description`: `Review $ARGUMENTS`
- `prompt`: the text between the `<prompt>` tags below, passed verbatim

<prompt>
Review the implementation for task $ARGUMENTS.

Read the current task state:
- backlog_task_view — id: "$ARGUMENTS"

Run quality tools (use a 300-second timeout on pytest and mypy — they can take several minutes):
```bash
uv run pytest --tb=short -q
uv run ruff check src/ tests/
uv run mypy src/
```

Review for production quality: type annotations on public functions, error handling covers all failure cases, tests cover success/error/edge cases, all acceptance criteria checked, all Definition of Done items checked, code follows project conventions.

If everything passes:
  1. Check off every Definition of Done item (1-based index):
     backlog_task_edit — id: "$ARGUMENTS", definitionOfDoneCheck: [<index>]
  2. Write a final summary and close the task:
     backlog_task_edit — id: "$ARGUMENTS", status: "Done", finalSummary: "<one paragraph>"

If issues remain, append a note and leave the status as In Progress:
  backlog_task_edit — id: "$ARGUMENTS", notesAppend: ["Review issues: <list>"]

Your last output line must be exactly one of:
  REVIEW RESULT: PASS
  REVIEW RESULT: FAIL — <one-line summary>
</prompt>

Check the reviewer's last output line:
- If `REVIEW RESULT: PASS` — proceed to Step 5.
- If `REVIEW RESULT: FAIL` — spawn a developer to fix the reported issues (do NOT fix them yourself).

Call the Agent tool with:
- `subagent_type`: `developer`
- `description`: `Fix review issues $ARGUMENTS`
- `maxOutput`: `{ lines: 20000 }`
- `prompt`: the text between the `<prompt>` tags below, passed verbatim

<prompt>
Fix the review issues for task $ARGUMENTS.

Read the current task state to find the review issues in the notes:
- backlog_task_view — id: "$ARGUMENTS"

Fix each issue. For each fix: edit the file, run the relevant quality tool to confirm it passes, then move on.

When all issues are resolved run the full suite:
```bash
uv run pytest --tb=short -q
uv run ruff check src/ tests/
uv run mypy src/
```

All must pass before you finish.
</prompt>

After the fix developer returns, re-run the reviewer (Step 4) up to **2 total reviewer attempts**. If still failing after 2, report the remaining issues to the user and stop.

---

## Step 5 — Hooks

Run pre-commit hooks and fix any failures before the commit step.

Call the Agent tool with:
- `subagent_type`: `developer`
- `description`: `Pre-commit hooks $ARGUMENTS`
- `maxOutput`: `{ lines: 5000 }`
- `prompt`: the text between the `<prompt>` tags below, passed verbatim

<prompt>
Run pre-commit hooks for task $ARGUMENTS and fix any failures.

```bash
lefthook run pre-commit 2>&1; echo "EXIT: $?"
```

Use a 600-second timeout on that command — hooks can take several minutes.

If all hooks pass (EXIT: 0), output "HOOKS: PASS" and stop.

If any hook fails:
1. Read the failure output carefully
2. Fix each reported issue — edit the file, run the specific failing tool to confirm the fix
3. Re-run `lefthook run pre-commit 2>&1; echo "EXIT: $?"` (timeout: 600)
4. Repeat until all hooks pass

Do not stage or commit anything.

Your last output line must be exactly one of:
  HOOKS: PASS
  HOOKS: FAIL — <one-line summary>
</prompt>

Check the agent's last output line:
- If `HOOKS: PASS` — proceed to Step 6.
- If `HOOKS: FAIL` — spawn the agent once more. If still failing after 2 total attempts, report the hook failures to the user and stop.

---

## Step 6 — Committer (only if hooks passed)

Call the Agent tool with:
- `subagent_type`: `committer`
- `description`: `Commit $ARGUMENTS`
- `prompt`: the text between the `<prompt>` tags below, passed verbatim

<prompt>
Commit all changes for task $ARGUMENTS.

Check what changed:
```bash
git status
git diff --stat
```

Stage all modified files explicitly — no `git add .` or `git add -A`:
```bash
git add <each specific file that was created or modified>
git add backlog/tasks/
```

Commit with `--no-verify` (hooks were already validated in the prior step — re-running them inside git commit will cause a hang):
```bash
git commit --no-verify -m "$ARGUMENTS: <short description of what was implemented>"
```
</prompt>
