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
        "detect In Progress / Dev Ready / Needs Plan tickets via backlog CLI",
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
      detail: "pick next To Do ticket from Sequence 1 and move to Needs Plan",
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
    : 3;

const SETUP_SCHEMA = {
  type: "object",
  properties: {
    statuses: { type: "array", items: { type: "string" } },
    changed: { type: "boolean" },
  },
  required: ["statuses", "changed"],
};

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
  },
  required: ["inProgress", "devReady", "needsPlan"],
};

const CHOOSE_SCHEMA = {
  type: "object",
  properties: {
    ticketId: {
      type: ["string", "null"],
      description:
        "The ticket ID moved to Needs Plan, or null if no eligible To Do ticket exists",
    },
    reason: {
      type: "string",
      description: "Short explanation of the choice or why nothing was chosen",
    },
  },
  required: ["ticketId", "reason"],
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

const STATE_PROMPT = `In the gql-fiddle repo (repo root, no git submodules), run:
- backlog task list -s "In Progress" --plain
- backlog task list -s "Dev Ready" --plain
- backlog task list -s "Needs Plan" --plain

Report the ticket IDs found in each list, in the order shown, via the structured output.`;

const CHOOSE_PROMPT = `You're working in the gql-fiddle repo at its root.

Run: backlog sequence list --plain

Find tickets in "Sequence 1" with status "To Do", in the order listed. If Sequence 1 has none, fall back to "Unsequenced" tickets with status "To Do", in order.

For each candidate in that order, run: backlog task <id> --plain
Skip the candidate if:
- its status is not exactly "To Do" (e.g. skip "Backlog" or "Blocked" status tickets), or
- its Labels include "no-ralph", or
- it has an unresolved dependency (a listed dependency whose own status is not "Done")

Pick the first candidate that passes both checks. If you find one, set its status to Needs Plan:
  backlog task edit <id> -s "Needs Plan"

Report via structured output:
- ticketId: the chosen ticket's ID, or null if no eligible candidate was found
- reason: a short explanation of the choice (or why nothing was eligible)`;

function executePrompt(ticketId) {
  return `You're working in the gql-fiddle repo at its root (no git submodules — commits happen directly here).

Use the Skill tool to invoke "/backlog-execute ${ticketId}". This skill will claim the ticket, implement the work, mark acceptance criteria, add implementation notes/summary, set the ticket status to Done, and commit the result — all per its own instructions. If the skill determines the ticket is blocked by new/unforeseen work, it will revert the ticket's status to "To Do" and exit without completing it.

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
    continue;
  }

  phase("Choose");
  const choice = await agent(CHOOSE_PROMPT, {
    schema: CHOOSE_SCHEMA,
    model: "haiku",
    phase: "Choose",
  });
  if (!choice) {
    stopReason = "choose-error";
    log("Choose step failed; stopping.");
    break;
  }
  if (!choice.ticketId) {
    stopReason = "drained";
    log(`Backlog drained: ${choice.reason}`);
    break;
  }
  log(`Iteration ${i + 1}: choose -> ${choice.ticketId}`);
  results.push({
    ticketId: choice.ticketId,
    phase: "choose",
    outcome: "queued-for-planning",
    summary: choice.reason,
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
