export const meta = {
  name: "ralph-backlog-loop",
  description:
    "Priority-ordered autonomous backlog loop: execute > plan > choose",
  phases: [
    {
      title: "Setup",
      detail: "ensure required backlog statuses exist",
      model: "haiku",
    },
    {
      title: "State",
      detail:
        "one CLI-only sweep: In Progress / Dev Ready / Needs Plan tickets, priority-sorted To Do with dependencies, no-ralph list",
      model: "haiku",
    },
    { title: "Execute", detail: "run /backlog-execute on one ticket" },
    {
      title: "Review",
      detail:
        "every 3 executes: review recent work and create follow-up tickets for issues",
    },
    {
      title: "Plan",
      detail:
        "run /backlog-planner; large tickets decomposed into sub-tasks that each re-enter the loop",
    },
    {
      title: "Choose",
      detail:
        "deterministically pick the priority-sorted To Do ticket with no unresolved (non-Done) dependencies and move it to Needs Plan",
      model: "haiku",
    },
  ],
};

const MAX_ITERATIONS = (() => {
  if (typeof args === "number") return args;
  if (
    args &&
    typeof args === "object" &&
    typeof args.maxIterations === "number"
  )
    return args.maxIterations;
  return 25;
})();

const REVIEW_EVERY =
  args && typeof args === "object" && typeof args.reviewEvery === "number"
    ? args.reviewEvery
    : 4;

const SETUP_SCHEMA = {
  type: "object",
  properties: {
    statuses: { type: "array", items: { type: "string" } },
    changed: { type: "boolean" },
  },
  required: ["statuses", "changed"],
};

// One flat data-gathering call per iteration covers everything the loop needs
// to pick a branch AND (when it falls through to Choose) pick a target —
// instead of a separate State call every iteration plus a second Discover
// call only on iterations that reach Choose. All of this is pure CLI-output
// extraction, no judgment: the script does the actual branch/target decision
// with plain array/set logic (see isReady below), since asking an LLM to
// re-derive "does this ticket have any unresolved dependency?" across many
// candidates is exactly how TASK-96.2 once got chosen as Dev Ready despite
// having unresolved dependencies. `backlog sequence list` (which used to
// compute that dependency-readiness graph server-side) was removed from the
// CLI, so this reconstructs readiness itself from each candidate's
// `dependencies` array (`backlog task <id> --json`) cross-referenced against
// each dependency's status — still resolved entirely in JS below, never left
// to agent judgment.
const STATE_SCHEMA = {
  type: "object",
  properties: {
    inProgress: {
      type: "array",
      items: { type: "string" },
      description: "Ticket IDs with status In Progress, in list order",
    },
    devReady: {
      type: "array",
      items: { type: "string" },
      description: "Ticket IDs with status Dev Ready, in list order",
    },
    needsPlan: {
      type: "array",
      items: { type: "string" },
      description: "Ticket IDs with status Needs Plan, in list order",
    },
    todoByPriority: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
        },
        required: ["id", "dependencies"],
      },
      description:
        'One entry per ticket from `backlog task list -s "To Do" --sort priority --json`, in the order shown (already sorted high -> medium -> low -> unset), each paired with its "dependencies" array read from `backlog task <id> --json` for that same ticket.',
    },
    depStatus: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
        },
        required: ["id", "status"],
      },
      description:
        'One entry per UNIQUE ticket id referenced in any todoByPriority entry\'s "dependencies" array (skip duplicates; empty array if none of the To Do tickets have dependencies), giving that id\'s "status" from `backlog task <id> --json`. Do not include ids that are not referenced as a dependency.',
    },
    noRalph: {
      type: "array",
      items: { type: "string" },
      description:
        'Every ticket ID from `backlog task list -s "To Do" -l no-ralph --json` (may be empty).',
    },
  },
  required: [
    "inProgress",
    "devReady",
    "needsPlan",
    "todoByPriority",
    "depStatus",
    "noRalph",
  ],
};

const MOVE_SCHEMA = {
  type: "object",
  properties: {
    ticketId: { type: "string" },
    success: { type: "boolean" },
  },
  required: ["ticketId", "success"],
};

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    ticketId: { type: "string" },
    status: {
      type: "string",
      description: "The ticket's current status field, exactly as shown",
    },
    depsResolved: {
      type: "boolean",
      description:
        'True if this ticket\'s "dependencies" array (from `backlog task <id> --json`) is empty, or every id in it has status exactly "Done" (checked via `backlog task <depId> --json` for each). False if any dependency is not Done.',
    },
    corrected: {
      type: "boolean",
      description:
        "True if this call found status=Dev Ready and depsResolved=false and fixed it (edited to Blocked + note), false otherwise (including when no fix was needed)",
    },
  },
  required: ["ticketId", "status", "depsResolved", "corrected"],
};

const BACKLOG_CHECK_SCHEMA = {
  type: "object",
  properties: {
    count: { type: "number" },
    sampleIds: { type: "array", items: { type: "string" } },
  },
  required: ["count", "sampleIds"],
};

const ACTION_SCHEMA = {
  type: "object",
  properties: {
    ticketId: { type: "string" },
    outcome: {
      type: "string",
      description: "One of: completed, blocked-reverted, planned, error",
    },
    summary: {
      type: "string",
      description: "One sentence describing what happened",
    },
  },
  required: ["ticketId", "outcome", "summary"],
};

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    ticketsReviewed: { type: "array", items: { type: "string" } },
    issuesFound: { type: "number" },
    ticketsCreated: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["ticketsReviewed", "issuesFound", "ticketsCreated", "summary"],
};

const SETUP_PROMPT = `You're working in the gql-fiddle repo at its root.

Read backlog/config.yml and look at the \`statuses\` list. This project's backlog work loop needs a 5-stage pipeline:
  To Do -> Needs Plan -> Dev Ready -> In Progress -> Done

"Blocked" is also a valid status (a dead-end for tickets that cannot proceed) — leave it alone if present.

If "Dev Ready" is not already in the statuses list, add it (insert it between "Needs Plan" and "In Progress") and save the file. Do not remove, rename, or reorder any other existing statuses.

Report via structured output:
- statuses: the final statuses list (after your edit, if any)
- changed: true if you modified the file, false if it already had everything needed`;

const STATE_PROMPT = `In the gql-fiddle repo (repo root, no git submodules), run these commands and report the results below. This is pure data extraction — no filtering, judgment, or dependency reasoning needed, the caller does that:

1. backlog task list -s "In Progress" --json -> inProgress: the "id" of every task in the "tasks" array, in order
2. backlog task list -s "Dev Ready" --json -> devReady: the "id" of every task in the "tasks" array, in order
3. backlog task list -s "Needs Plan" --json -> needsPlan: the "id" of every task in the "tasks" array, in order
4. backlog task list -s "To Do" --sort priority --json -> the ordered list of To Do task ids (already sorted high -> medium -> low -> unset)
5. For EACH id from step 4, run: backlog task <id> --json and read its "dependencies" array. Report todoByPriority as an array of {id, dependencies} objects, one per To Do ticket, in the same order as step 4.
6. Collect the set of unique dependency ids across every "dependencies" array from step 5 (if none of the To Do tickets have dependencies, this set is empty). For each unique id in that set (and only those — do not query ids that aren't referenced as a dependency), run: backlog task <id> --json and read its "status". Report depStatus as an array of {id, status}, one entry per unique dependency id.
7. backlog task list -s "To Do" -l no-ralph --json -> noRalph: the "id" of every task in the "tasks" array (empty array if none)

Report all fields via the structured output.`;

function moveToNeedsPlanPrompt(ticketId) {
  return `You're working in the gql-fiddle repo at its root.

Run: backlog task edit ${ticketId} -s "Needs Plan"

Report via structured output: ticketId "${ticketId}", success (true if the edit succeeded, false otherwise).`;
}

function verifyAndCorrectPrompt(ticketId) {
  return `You're working in the gql-fiddle repo at its root.

Run: backlog task ${ticketId} --json
Read its "status" and "dependencies" array.

For each id in "dependencies" (if any), run: backlog task <id> --json and read its "status".

Determine:
- status: this ticket's current status field, exactly as shown
- depsResolved: true if "dependencies" is empty, or every dependency's status is exactly "Done"; false if any dependency's status is not "Done"

If status is exactly "Dev Ready" AND depsResolved is false, the planner was wrong to mark it ready — correct it now, in this same turn:
  backlog task edit ${ticketId} -s "Blocked"
and append one implementation note: planning marked this Dev Ready, but it still has an unresolved dependency, so it was forced to Blocked. It should be re-checked once its dependencies are Done.

Set corrected to true only if you made that fix just now; false otherwise (including when no fix was needed).

Report via structured output: ticketId "${ticketId}", status, depsResolved, corrected.`;
}

function backlogCheckPrompt() {
  return `You're working in the gql-fiddle repo at its root.

Run: backlog task list -s "Backlog" --json

Report via structured output:
- count: the number of tasks in the "tasks" array
- sampleIds: the "id" of up to the first 5 tasks in that array (fewer if there are fewer than 5, empty array if there are none)`;
}

function executePrompt(ticketId) {
  return `You're working in the gql-fiddle repo at its root (no git submodules — commits happen directly here).

Use the Skill tool to invoke "/backlog-execute ${ticketId}". This skill will claim the ticket, implement the work, mark acceptance criteria, add implementation notes/summary, set the ticket status to Done, and commit the result — all per its own instructions. If the skill determines the ticket is blocked by new/unforeseen work discovered mid-implementation, it will revert the ticket's status to "To Do".

Dependency readiness is already guaranteed before a ticket reaches you: the Plan phase verifies every ticket it marks "Dev Ready" has no unresolved (non-Done) dependencies before handing it off, so you should not need to re-check dependencies here. If you nonetheless find the ticket genuinely can't proceed, follow the skill's own blocked-handling behavior.

After the skill finishes, report via structured output:
- ticketId: "${ticketId}"
- outcome: "completed" if the ticket was finished and committed, "blocked-reverted" if it was reverted to To Do, or "error" if something went wrong
- summary: one sentence describing what happened`;
}

function planPrompt(ticketId) {
  return `You're working in the gql-fiddle repo at its root (no git submodules).

First, run: backlog task ${ticketId} --plain
If it already carries the "planned" label AND its status is still "Needs Plan", a previous loop iteration already finished planning it but failed to move it out of "Needs Plan" — do NOT re-invoke the full planner skill (it's expensive and the work is already done). Just apply the status rule below directly, based on whether it has sub-tickets/direct work, and report outcome "planned".

Otherwise, use the Skill tool to invoke "/backlog-planner ${ticketId}". This skill researches the ticket, analyzes dependencies, and writes a detailed implementation plan.

IMPORTANT — large ticket decomposition: If the ticket is large or complex, the planner SHOULD break it down into sub-tasks. Each sub-task will independently enter the backlog loop as its own ticket, going through the full choose → plan → execute cycle on its own. Each sub-task starts at "To Do" and will be picked up by the loop naturally in a future iteration.

Once planning is complete, the ticket must NOT be left in "Needs Plan" — the loop re-queries that status every iteration, and a ticket left there gets re-selected and re-planned from scratch on the very next pass. Set its status to exactly one of:
- "Dev Ready" — if the ticket has direct implementation work of its own (with or without sub-tasks alongside it):
    backlog task edit ${ticketId} -s "Dev Ready"
- "Blocked" — if all its work was fully delegated to sub-tasks and it is now a pure tracking/epic ticket with no direct implementation of its own. This matches the project's existing convention for such tracking tickets (e.g. TASK-8). A future pass (or a human) is expected to promote it out of "Blocked" once its children are Done:
    backlog task edit ${ticketId} -s "Blocked"

Report via structured output:
- ticketId: "${ticketId}"
- outcome: "planned" if planning completed and the status was moved out of "Needs Plan" (to Dev Ready or Blocked), or "error" if something went wrong
- summary: one sentence describing what was planned (and any sub-tickets created)`;
}

function reviewPrompt(executedTicketIds) {
  return `You're working in the gql-fiddle repo at its root.

The following tickets were recently implemented and committed: ${executedTicketIds.join(", ")}.

Review the work and create follow-up backlog tickets for any real issues found:

1. Find commits for this work:
     git log --oneline -20
   Identify commits related to the tickets listed above.

2. Use the Skill tool to invoke "/code-review" on the recent changes (medium effort is fine).

3. For each genuine issue (correctness bugs, significant inefficiencies, clear design problems — NOT nitpicks or style):
     backlog task create "Fix: <brief description>" --description "<detail>" --status "To Do" --label "review-fix"

   Only create tickets you'd actually want implemented. Err on the side of fewer, higher-signal tickets.

4. Report via structured output:
   - ticketsReviewed: the ticket IDs that were reviewed (${executedTicketIds.join(", ")})
   - issuesFound: number of issues that warranted new tickets
   - ticketsCreated: list of new ticket IDs created (empty array if none)
   - summary: one sentence summarizing the review outcome`;
}

phase("Setup");
const setup = await agent(SETUP_PROMPT, {
  schema: SETUP_SCHEMA,
  model: "haiku",
  phase: "Setup",
});
if (!setup) {
  return {
    stopReason: "setup-error",
    iterations: 0,
    results: [],
    table: "(setup failed)",
  };
}
log(
  `Setup: statuses = [${setup.statuses.join(", ")}]${setup.changed ? " (updated config.yml)" : ""}`,
);

const results = [];
let stopReason = "cap";
let executeCount = 0;
let executedSinceReview = [];
let lastExecuteTarget = null;
let lastExecuteOutcome = null;

for (let i = 0; i < MAX_ITERATIONS; i++) {
  phase("State");
  const state = await agent(STATE_PROMPT, {
    schema: STATE_SCHEMA,
    model: "haiku",
    phase: "State",
  });
  if (!state) {
    stopReason = "state-error";
    log("State detection failed; stopping.");
    break;
  }

  if (state.inProgress.length > 0 || state.devReady.length > 0) {
    const target = state.inProgress[0] || state.devReady[0];

    // Backstop: if the same ticket was blocked-reverted last iteration and is
    // still the top pick, the agent failed to move it out of the Dev Ready
    // pool. Don't burn the rest of the iteration cap re-trying it.
    if (
      target === lastExecuteTarget &&
      lastExecuteOutcome === "blocked-reverted"
    ) {
      results.push({
        ticketId: target,
        phase: "execute",
        outcome: "stuck",
        summary:
          "Same ticket re-selected immediately after a blocked-reverted outcome; it was not actually moved out of the Dev Ready pool. Stopping to avoid burning the iteration cap on repeats.",
      });
      stopReason = "stuck-ticket";
      break;
    }

    phase("Execute");
    log(`Iteration ${i + 1}: execute -> ${target}`);
    const outcome = await agent(executePrompt(target), {
      schema: ACTION_SCHEMA,
      phase: "Execute",
    });
    if (!outcome) {
      results.push({
        ticketId: target,
        phase: "execute",
        outcome: "error",
        summary: "subagent returned no result",
      });
      stopReason = "execute-error";
      break;
    }
    results.push({
      ticketId: target,
      phase: "execute",
      outcome: outcome.outcome,
      summary: outcome.summary,
    });
    lastExecuteTarget = target;
    lastExecuteOutcome = outcome.outcome;

    executeCount++;
    executedSinceReview.push(target);

    if (executeCount % REVIEW_EVERY === 0) {
      phase("Review");
      log(
        `Review triggered after ${REVIEW_EVERY} executes (${executedSinceReview.join(", ")})`,
      );
      const review = await agent(reviewPrompt(executedSinceReview), {
        schema: REVIEW_SCHEMA,
        phase: "Review",
      });
      executedSinceReview = [];
      if (review) {
        results.push({
          ticketId: "(review)",
          phase: "review",
          outcome:
            review.issuesFound > 0
              ? `${review.issuesFound} issue(s) queued`
              : "clean",
          summary: review.summary,
        });
        if (review.ticketsCreated.length > 0) {
          log(
            `Review created ${review.ticketsCreated.length} follow-up ticket(s): ${review.ticketsCreated.join(", ")}`,
          );
        }
      }
    }

    continue;
  }

  if (state.needsPlan.length > 0) {
    const target = state.needsPlan[0];
    phase("Plan");
    log(`Iteration ${i + 1}: plan -> ${target}`);
    const outcome = await agent(planPrompt(target), {
      schema: ACTION_SCHEMA,
      phase: "Plan",
    });
    if (!outcome) {
      results.push({
        ticketId: target,
        phase: "plan",
        outcome: "error",
        summary: "subagent returned no result",
      });
      stopReason = "plan-error";
      break;
    }
    results.push({
      ticketId: target,
      phase: "plan",
      outcome: outcome.outcome,
      summary: outcome.summary,
    });

    // Deterministic correctness check, not the planner's judgment call: the
    // planner decides Dev Ready vs Blocked based on "does it have direct work
    // vs is it a pure tracking ticket," which is orthogonal to "are its
    // declared dependencies actually Done." Verify independently and force
    // Blocked if the planner got that wrong (this is exactly how TASK-96.2
    // ended up in Dev Ready with two unresolved dependencies).
    if (outcome.outcome === "planned") {
      const verify = await agent(verifyAndCorrectPrompt(target), {
        schema: VERIFY_SCHEMA,
        model: "haiku",
        phase: "Plan",
      });
      if (verify && verify.corrected) {
        log(
          `Corrected ${target}: planner set "Dev Ready" but it still has an unresolved dependency — forced to "Blocked".`,
        );
        results.push({
          ticketId: target,
          phase: "plan",
          outcome: "corrected-to-blocked",
          summary:
            "Planner marked this Dev Ready but it still has an unresolved dependency; forced to Blocked so Execute never receives it.",
        });
      }
    }
    continue;
  }

  // Choose: the State call above already gathered todoByPriority/depStatus/
  // noRalph, so no second data-gathering round trip is needed here — just
  // the deterministic pick and (if one was found) the mutation to move it.
  // This loop deliberately only ever queues from "To Do" — "Backlog" status
  // is a separate, human-curated holding area upstream of it (see the
  // drained-branch warning below for surfacing unpromoted work there).
  phase("Choose");
  const depStatus = new Map(state.depStatus.map((d) => [d.id, d.status]));
  const noRalph = new Set(state.noRalph);
  const isReady = (dependencies) =>
    dependencies.every((depId) => depStatus.get(depId) === "Done");
  const candidate = state.todoByPriority.find(
    (t) => isReady(t.dependencies) && !noRalph.has(t.id),
  );
  const target = candidate ? candidate.id : null;

  if (!target) {
    stopReason = "drained";
    log(
      "Backlog drained: no To Do ticket has all dependencies Done and is unlabeled no-ralph.",
    );

    // "To Do" is the only status this loop queues from — tickets sitting in
    // "Backlog" are never picked up automatically (by design: promotion is a
    // deliberate human decision). Surface that instead of silently stopping,
    // since a drained-but-Backlog-is-full state usually means work is
    // waiting on a promotion step, not that the project has run out of work.
    const backlogCheck = await agent(backlogCheckPrompt(), {
      schema: BACKLOG_CHECK_SCHEMA,
      model: "haiku",
      phase: "Choose",
    });
    if (backlogCheck && backlogCheck.count > 0) {
      const sample = backlogCheck.sampleIds.join(", ");
      log(
        `Note: ${backlogCheck.count} ticket(s) are sitting in "Backlog" status and were not considered (e.g. ${sample}) — promote with \`backlog task edit <id> -s "To Do"\` if they should run.`,
      );
      results.push({
        ticketId: "(warning)",
        phase: "choose",
        outcome: `${backlogCheck.count} ticket(s) in Backlog`,
        summary: `Not considered — this loop only pulls from "To Do". Sample: ${sample}`,
      });
    }
    break;
  }

  const moved = await agent(moveToNeedsPlanPrompt(target), {
    schema: MOVE_SCHEMA,
    model: "haiku",
    phase: "Choose",
  });
  if (!moved || !moved.success) {
    stopReason = "choose-error";
    log(`Failed to move ${target} to Needs Plan; stopping.`);
    break;
  }

  log(`Iteration ${i + 1}: choose -> ${target}`);
  results.push({
    ticketId: target,
    phase: "choose",
    outcome: "queued-for-planning",
    summary: `Deterministically picked: highest-priority To Do ticket with no unresolved dependencies and not labeled no-ralph, out of ${state.todoByPriority.length} To Do candidate(s).`,
  });
}

const table = [
  "| Ticket | Phase | Outcome | Summary |",
  "|---|---|---|---|",
  ...results.map(
    (r) => `| ${r.ticketId} | ${r.phase} | ${r.outcome} | ${r.summary} |`,
  ),
].join("\n");

return { stopReason, iterations: results.length, results, table };
