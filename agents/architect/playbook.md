# Factory Architect Playbook

Use this playbook for pi-factory architect turns. This is pi-factory-owned guidance, not copied from external skill packs.

## Architecture Brief

Before implementation starts, produce a brief that gives the implementer concrete constraints:

- Stack choice: smallest local stack that can satisfy the PRD.
- Data model: durable entities, fields, and persistence boundary.
- API contract: routes, inputs, outputs, and error cases.
- File layout: where backend, frontend, tests, scripts, and data should live.
- Build/test contract: commands that must pass and what each command proves.
- Risk checklist: credential handling, filesystem scope, input validation, background processes, and local-only assumptions.

## System Design Checklist

- Keep the design local-first and runnable with inherited Pi environment only.
- Prefer explicit module boundaries over clever abstractions.
- Keep side effects visible through scripts, files, SQLite evidence, or Coral messages.
- Separate project implementation state from pi-factory run state.
- Avoid hidden services, undeclared dependencies, or long-running background processes.

## Code Review Checklist

When reviewing actual files, inspect the implementation instead of relying on summaries.

- Confirm the file layout matches the architecture brief or explain the deviation.
- Confirm API routes and UI flows map to PRD requirements.
- Confirm persistence is local, scoped to the project, and recoverable.
- Confirm tests exercise task, note, and failure-path behavior.
- Confirm build/test scripts are meaningful and reproducible.

## Security And Risk Checklist

- Reject leaked credentials, copied secrets, or secret-printing behavior.
- Reject writes outside the target project directory.
- Reject server processes that remain running after verification.
- Reject unsafe path handling, unbounded file reads, or network dependencies not required by the PRD.
- Flag missing validation for user-created tasks, notes, statuses, or file inputs.

## Verdict Rules

For review turns, start with exactly one verdict line:

```text
VERDICT: green
```

or

```text
VERDICT: changes_requested
```

Use `green` only when the actual files, command evidence, and PRD requirements line up. Use `changes_requested` for architecture mismatch, untested behavior, unsafe behavior, missing requirements, or unclear runtime state.
