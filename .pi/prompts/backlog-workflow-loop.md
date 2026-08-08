Pick the next ready backlog task and run it to completion, fully autonomously.

This prompt takes NO arguments — you choose the task yourself. It is designed to be run repeatedly (e.g. in an overnight loop): each invocation completes exactly ONE ticket, then stops. The external loop re-invokes it for the next ticket.

**You are the orchestrator — never the implementer.** You may not read project source files, edit code, run tests, or fix bugs directly. All implementation work goes through subagents. Your only direct tool calls are: `mcp`, `bash` (grep/awk/backlog CLI only — no file editing, no running tests), `git status --short`, reading the workflow file named in Step 1, and spawning agents.

**On agent error**: if any spawned agent returns an explicit error, report which step failed in one line and stop. Do not attempt to recover or do the step yourself.

**Output truncation is normal** for long-running steps — verify completion via grep against the task file, not by reading agent output text.

---

## Step 0 — Select the next task

1. List candidate tasks, priority-sorted (this loop only ever queues from "To Do" — "Backlog" is a separate, human-curated holding area; a ticket must be deliberately promoted with `backlog task edit <id> -s "To Do"` before this loop will consider it):
   ```bash
   backlog task list -s "To Do" --sort priority --json
   ```
   If the `tasks` array is empty, output exactly `BACKLOG LOOP: NOTHING TO DO` and stop.

2. Walk the candidates in the order returned (highest priority first). For each candidate `id`, check whether it's ready — i.e. has no unresolved dependency:
   ```bash
   backlog task <id> --json
   ```
   Read its `dependencies` array. If it's empty, the candidate is ready. Otherwise, for each id in `dependencies`, run:
   ```bash
   backlog task <depId> --json
   ```
   and read its `status`. The candidate is ready only if every dependency's status is exactly `Done`.

   Take the FIRST ready candidate in priority order. Its status was already confirmed `To Do` by the `-s "To Do"` filter in step 1, so no separate startability re-check is needed.

3. If no candidate is ready (every one still has an unresolved dependency), output exactly `BACKLOG LOOP: NOTHING TO DO` and stop.

4. Record `TASK_ID` = the chosen candidate's id. From here on, treat `TASK_ID` exactly as `$ARGUMENTS` would be treated by the automated workflow.

Announce: `BACKLOG LOOP: working on <TASK_ID> — <title>`.

---

## Step 1 — Run the automated workflow on TASK_ID

Execute the entire automated backlog workflow for `TASK_ID`.

Read the workflow definition (this is a workflow file, not project source, so reading it is allowed):
```bash
cat .pi/prompts/backlog-workflow-auto.md
```

Then follow EVERY step in that file in order — Preamble, Step 1 (Researcher), Step 2 (Architect), Step 3 (Developer per-AC loop), Step 4 (Reviewer), Step 5 (Hooks), Step 6 (Committer) — substituting `TASK_ID` everywhere that file says `$ARGUMENTS`. Do not skip the reviewer, hooks, or commit steps. That workflow already handles research/plan reuse, the architect refine pass, the per-AC developer loop, review, pre-commit hooks, and the commit.

---

## After the workflow

- If the workflow reached the committer and committed successfully, output exactly:
  `BACKLOG LOOP: completed <TASK_ID>`
- If any step hit a hard stop (a stuck acceptance criterion, hooks still failing after 2 attempts, review still failing after 2 attempts, or an agent error), do NOT pick another task. Output exactly:
  `BACKLOG LOOP: stopped on <TASK_ID> — <one-line reason>`
  and stop, so the failure is visible in the morning.

Complete only ONE task per invocation. Do not loop back to Step 0 yourself — the external loop will re-invoke this prompt for the next ticket.
