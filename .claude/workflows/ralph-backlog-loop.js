export const meta = {
  name: 'ralph-backlog-loop',
  description: 'Priority-ordered autonomous backlog loop: execute > plan > choose',
  phases: [
    { title: 'Setup', detail: 'ensure required backlog statuses exist', model: 'haiku' },
    { title: 'State', detail: 'detect In Progress / Dev Ready / Needs Plan tickets via backlog CLI', model: 'haiku' },
    { title: 'Execute', detail: 'run /backlog-execute on one ticket' },
    { title: 'Plan', detail: 'run /backlog-planner on one ticket' },
    { title: 'Choose', detail: 'pick next To Do ticket from Sequence 1 and move to Needs Plan', model: 'haiku' },
  ],
}

const MAX_ITERATIONS = (() => {
  if (typeof args === 'number') return args
  if (args && typeof args === 'object' && typeof args.maxIterations === 'number') return args.maxIterations
  return 25
})()

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    statuses: { type: 'array', items: { type: 'string' } },
    changed: { type: 'boolean' },
  },
  required: ['statuses', 'changed'],
}

const STATE_SCHEMA = {
  type: 'object',
  properties: {
    inProgress: { type: 'array', items: { type: 'string' }, description: 'Ticket IDs with status In Progress, in list order' },
    devReady: { type: 'array', items: { type: 'string' }, description: 'Ticket IDs with status Dev Ready, in list order' },
    needsPlan: { type: 'array', items: { type: 'string' }, description: 'Ticket IDs with status Needs Plan, in list order' },
  },
  required: ['inProgress', 'devReady', 'needsPlan'],
}

const CHOOSE_SCHEMA = {
  type: 'object',
  properties: {
    ticketId: { type: ['string', 'null'], description: 'The ticket ID moved to Needs Plan, or null if no eligible To Do ticket exists' },
    reason: { type: 'string', description: 'Short explanation of the choice or why nothing was chosen' },
  },
  required: ['ticketId', 'reason'],
}

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    ticketId: { type: 'string' },
    outcome: { type: 'string', description: 'One of: completed, blocked-reverted, planned, error' },
    summary: { type: 'string', description: 'One sentence describing what happened' },
  },
  required: ['ticketId', 'outcome', 'summary'],
}

const SETUP_PROMPT = `You're working in the graphql-playground repo at its root.

Read backlog/config.yml and look at the \`statuses\` list. This project's backlog work loop needs a 5-stage pipeline:
  To Do -> Needs Plan -> Dev Ready -> In Progress -> Done

If "Dev Ready" is not already in the statuses list, add it (insert it between "Needs Plan" and "In Progress") and save the file. Do not remove, rename, or reorder any other existing statuses.

Report via structured output:
- statuses: the final statuses list (after your edit, if any)
- changed: true if you modified the file, false if it already had everything needed`

const STATE_PROMPT = `In the graphql-playground repo (repo root, no git submodules), run:
- backlog task list -s "In Progress" --plain
- backlog task list -s "Dev Ready" --plain
- backlog task list -s "Needs Plan" --plain

Report the ticket IDs found in each list, in the order shown, via the structured output.`

const CHOOSE_PROMPT = `You're working in the graphql-playground repo at its root.

Run: backlog sequence list --plain

Find tickets in "Sequence 1" with status "To Do", in the order listed. If Sequence 1 has none, fall back to "Unsequenced" tickets with status "To Do", in order.

For each candidate in that order, run: backlog task <id> --plain
Skip the candidate if:
- its Labels include "no-ralph", or
- it has an unresolved dependency (a listed dependency whose own status is not "Done")

Pick the first candidate that passes both checks. If you find one, set its status to Needs Plan:
  backlog task edit <id> -s "Needs Plan"

Report via structured output:
- ticketId: the chosen ticket's ID, or null if no eligible candidate was found
- reason: a short explanation of the choice (or why nothing was eligible)`

function executePrompt(ticketId) {
  return `You're working in the graphql-playground repo at its root (no git submodules — commits happen directly here).

Use the Skill tool to invoke "/backlog-execute ${ticketId}". This skill will claim the ticket, implement the work, mark acceptance criteria, add implementation notes/summary, set the ticket status to Done, and commit the result — all per its own instructions. If the skill determines the ticket is blocked by new/unforeseen work, it will revert the ticket's status to "To Do" and exit without completing it.

After the skill finishes, report via structured output:
- ticketId: "${ticketId}"
- outcome: "completed" if the ticket was finished and committed, "blocked-reverted" if it was reverted to To Do, or "error" if something went wrong
- summary: one sentence describing what happened`
}

function planPrompt(ticketId) {
  return `You're working in the graphql-playground repo at its root (no git submodules).

Use the Skill tool to invoke "/backlog-planner ${ticketId}". This skill researches the ticket, analyzes dependencies, may create sub-tickets for discrete work, and writes a detailed implementation plan.

Once planning is complete, set the ticket's status to "Dev Ready":
  backlog task edit ${ticketId} -s "Dev Ready"

Report via structured output:
- ticketId: "${ticketId}"
- outcome: "planned" if planning completed and the status was set to Dev Ready, or "error" if something went wrong
- summary: one sentence describing what was planned (and any sub-tickets created)`
}

phase('Setup')
const setup = await agent(SETUP_PROMPT, { schema: SETUP_SCHEMA, model: 'haiku', phase: 'Setup' })
if (!setup) {
  return { stopReason: 'setup-error', iterations: 0, results: [], table: '(setup failed)' }
}
log(`Setup: statuses = [${setup.statuses.join(', ')}]${setup.changed ? ' (updated config.yml)' : ''}`)

const results = []
let stopReason = 'cap'

for (let i = 0; i < MAX_ITERATIONS; i++) {
  phase('State')
  const state = await agent(STATE_PROMPT, { schema: STATE_SCHEMA, model: 'haiku', phase: 'State' })
  if (!state) { stopReason = 'state-error'; log('State detection failed; stopping.'); break }

  if (state.inProgress.length > 0 || state.devReady.length > 0) {
    const target = state.inProgress[0] || state.devReady[0]
    phase('Execute')
    log(`Iteration ${i + 1}: execute -> ${target}`)
    const outcome = await agent(executePrompt(target), { schema: ACTION_SCHEMA, phase: 'Execute' })
    if (!outcome) {
      results.push({ ticketId: target, phase: 'execute', outcome: 'error', summary: 'subagent returned no result' })
      stopReason = 'execute-error'
      break
    }
    results.push({ ticketId: target, phase: 'execute', outcome: outcome.outcome, summary: outcome.summary })
    continue
  }

  if (state.needsPlan.length > 0) {
    const target = state.needsPlan[0]
    phase('Plan')
    log(`Iteration ${i + 1}: plan -> ${target}`)
    const outcome = await agent(planPrompt(target), { schema: ACTION_SCHEMA, phase: 'Plan' })
    if (!outcome) {
      results.push({ ticketId: target, phase: 'plan', outcome: 'error', summary: 'subagent returned no result' })
      stopReason = 'plan-error'
      break
    }
    results.push({ ticketId: target, phase: 'plan', outcome: outcome.outcome, summary: outcome.summary })
    continue
  }

  phase('Choose')
  const choice = await agent(CHOOSE_PROMPT, { schema: CHOOSE_SCHEMA, model: 'haiku', phase: 'Choose' })
  if (!choice) { stopReason = 'choose-error'; log('Choose step failed; stopping.'); break }
  if (!choice.ticketId) {
    stopReason = 'drained'
    log(`Backlog drained: ${choice.reason}`)
    break
  }
  log(`Iteration ${i + 1}: choose -> ${choice.ticketId}`)
  results.push({ ticketId: choice.ticketId, phase: 'choose', outcome: 'queued-for-planning', summary: choice.reason })
}

const table = [
  '| Ticket | Phase | Outcome | Summary |',
  '|---|---|---|---|',
  ...results.map(r => `| ${r.ticketId} | ${r.phase} | ${r.outcome} | ${r.summary} |`),
].join('\n')

return { stopReason, iterations: results.length, results, table }
