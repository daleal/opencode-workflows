---
name: workflows
description: Use to generate agentic workflows to run sub-agents, deterministic loops or complex flows. Useful when a task is too big to be solved by just one agent, and will benefit from having a structured step-by-step approach. This skill is designed to help you break down complex tasks into manageable steps.
---

# Workflows

Use OpenCode's TypeScript SDK to write workflows that coordinate multiple OpenCode agents and sessions with deterministic application logic.

## Before Writing

1. Read [example.ts](references/example.ts) completely and follow its OpenCode SDK, helper, session, and export conventions.
2. Ensure `.opencode/.gitignore` exists and contains `workflows/` so generated workflow files are not committed.
3. Ensure `.opencode/workflows/utils.ts` exists. If it does not, copy the contents of [scripts/utils.ts](references/scripts/utils.ts) there verbatim before writing the workflow.

## File Layout

Every workflow must live in its own named folder under `.opencode/workflows`. Write workflow files only at:

```text
.opencode/workflows/runtime/<workflow-name>-<random-suffix>/**/*.ts
```

Append a fresh random suffix to every workflow folder name. Generate an 8-character hexadecimal suffix with:

```sh
openssl rand -hex 4
```

For example, a `code-review` workflow with output `a1b2c3d4` must live under `.opencode/workflows/runtime/code-review-a1b2c3d4`. Generate the suffix once per workflow and use that same folder name everywhere, including imports and the `run-workflow` entrypoint path.

Do not place workflow entrypoints directly in `.opencode/workflows/runtime`. The only TypeScript file allowed directly in that directory is the required shared `.opencode/workflows/utils.ts`.

Import the shared helpers from the correct relative path, typically `../utils.js` for an entrypoint directly inside its workflow folder.

## Implementation

- Orchestrate agents through the OpenCode SDK client provided by `workflow`; do not use another agent framework or SDK.
- Export the workflow entrypoint as the module's default function. It must accept a `WorkflowRuntime`, pass it as the first argument to `workflow`, and pass a concise human-readable workflow name as the second argument.
- Use `workflow` and `promptStructured` from `utils.ts` when appropriate.
- Use the progress reporter passed to the `workflow` callback to name each meaningful phase. Report semantic phases such as planning, parallel execution, and synthesis; worker sessions and tool activity are tracked automatically.
- Use the raw `client.session` SDK API for unformatted prompts and other session operations.
- Give independent agents separate child sessions.
- Run unrelated steps concurrently whenever possible, typically with `Promise.all`. Keep dependent steps sequential.
- Return an object containing a very descriptive summary string from the workflow entrypoint function. This string will be used as the final output of the workflow, and should summarize the steps and results of the workflow.
  - You can return secondary data too if you feel it is useful for the workflow's consumers, but the summary is the only required return value.

## Running

Run workflows exclusively with the `run-workflow` tool. Pass the entrypoint path relative to `.opencode/workflows/runtime`, for example:

```text
code-review-a1b2c3d4/main.ts
```
