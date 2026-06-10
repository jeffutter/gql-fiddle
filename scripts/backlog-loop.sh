#!/usr/bin/env bash
#
# Overnight autonomous backlog runner.
#
# Repeatedly invokes the `backlog-workflow-loop` pi prompt. Each invocation picks
# the next ready task (the first task in "Sequence 1" of `backlog sequence list`)
# and runs it end to end (research -> plan refine -> implement -> review -> hooks
# -> commit). The loop stops cleanly when:
#   - the backlog is drained        (prompt prints "BACKLOG LOOP: NOTHING TO DO")
#   - a ticket gets stuck           (prompt prints "BACKLOG LOOP: stopped on ...")
#   - the safety iteration cap hits  (MAX_ITERS)
#
# Usage:
#   ./scripts/backlog-loop.sh
#
# Configuration (environment variables):
#   PI_CMD        How to invoke a pi prompt non-interactively. The prompt name is
#                 appended as the final argument. Default: "pi run".
#                 Example: PI_CMD='pi run' ./scripts/backlog-loop.sh
#   PROMPT        Prompt name to run. Default: "backlog-workflow-loop".
#   MAX_ITERS     Safety cap on number of tickets per run. Default: 50.
#   SLEEP_SECS    Pause between tickets, in seconds. Default: 5.
#   LOG_DIR       Where to write run logs. Default: "loop-logs".
#   REVIEW_EVERY  Run review-pi-work every N successful iterations. Default: 5.
#
set -uo pipefail

# Always operate from the repo root so the `backlog` CLI finds the project.
cd "$(dirname "$0")/.." || exit 1

PI_CMD="${PI_CMD:-pi -p}"
PROMPT="${PROMPT:-/backlog-workflow-loop}"
MAX_ITERS="${MAX_ITERS:-50}"
SLEEP_SECS="${SLEEP_SECS:-5}"
LOG_DIR="${LOG_DIR:-loop-logs}"
REVIEW_EVERY="${REVIEW_EVERY:-5}"

SKILL_FILE=".claude/skills/review-pi-work/SKILL.md"

mkdir -p "$LOG_DIR"
run_log="$LOG_DIR/loop-$(date +%Y%m%d-%H%M%S).log"
echo "backlog loop starting — logging to $run_log"
echo "  command: $PI_CMD $PROMPT   (cap: $MAX_ITERS tickets, review every $REVIEW_EVERY)"

iter=0
completed=0
while (( iter < MAX_ITERS )); do
  iter=$((iter + 1))
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "==== iteration $iter ($ts) ====" | tee -a "$run_log"

  # Run one ticket. Stream output to console and append to the log; capture it
  # so we can inspect the final status marker.
  out="$($PI_CMD "$PROMPT" 2>&1 | tee -a "$run_log")"

  if grep -q "BACKLOG LOOP: NOTHING TO DO" <<<"$out"; then
    echo "Nothing ready to work on — backlog drained. Stopping." | tee -a "$run_log"
    exit 0
  fi

  if grep -q "BACKLOG LOOP: stopped on" <<<"$out"; then
    echo "A ticket got stuck — stopping so it's visible in the morning. See log." | tee -a "$run_log"
    exit 1
  fi

  if ! grep -q "BACKLOG LOOP: completed" <<<"$out"; then
    echo "Unrecognized outcome (no completed/stopped/nothing marker) — stopping to be safe." | tee -a "$run_log"
    exit 2
  fi

  completed=$((completed + 1))

  if (( completed % REVIEW_EVERY == 0 )); then
    echo "==== review after $completed completions ($ts) ====" | tee -a "$run_log"
    if [[ -f "$SKILL_FILE" ]]; then
      claude --model opus -p "$(cat "$SKILL_FILE")" 2>&1 | tee -a "$run_log"
    else
      echo "WARNING: review skill not found at $SKILL_FILE — skipping review." | tee -a "$run_log"
    fi
  fi

  sleep "$SLEEP_SECS"
done

echo "Reached MAX_ITERS=$MAX_ITERS — stopping. Re-run to continue." | tee -a "$run_log"
