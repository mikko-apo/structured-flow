# structured-flow

Need to manage hundreds of business logic validation rules in code? Tired of scattered docs and complex code?
structured-flow helps you structure logic and visualize execution.

# Structured Flow API Example

This example shows the intended flow of the sequence API and two concrete runs of the same sequence.

- `createSyncFlow<Ctx, Info>()` starts a builder that accepts only synchronous step functions.
- `createAsyncFlow<Ctx, Info>()` starts a builder that accepts synchronous or async step functions.
- `.step(id, description, fn)` appends a step that can extend ctx and return structured step results.
- `.build()` returns a sequence with a single `run()` method.
- `FlowResult` contains the accumulated ctx, per-step results, and helper methods like `failedStepIds()`.
- `renderProcessAsMermaidGraph(...)` can render a builder, sequence, or executed sequence result.

## Flow And Step Execution

For a sequence built with `createSyncFlow()`, `run(initialCtx)` executes immediately and returns a
`FlowResult`. For a sequence built with `createAsyncFlow()`, `run(initialCtx)` awaits each step in order and
returns `Promise<FlowResult>`.

When a sequence starts, it copies the initial context and executes steps in order. Each step function receives the
current accumulated context and returns a structured step result object. That return object can contain:

- `result` to control execution flow
- `info` to record step metadata into `stepResults`
- additional fields that are merged into the context only when the result is `ok` or `stop`

Execution continues through `ok`, `error`, and explicit `skip` results. Execution stops early on `stop` or
`exception`, and all remaining steps are recorded as `skip`. If a step throws, the sequence catches it, records that
step as `exception`, and then marks the remaining steps as `skip`.

The table below summarizes how each recorded `result` value affects execution and context updates:

| Result value | Step executed | Flow continues | Returned fields added to context | Remaining steps auto-recorded as `skip` |
|--------------|---------------|----------------|----------------------------------|-----------------------------------------|
| `ok`         | yes           | yes            | yes                              | no                                      |
| `error`      | yes           | yes            | no                               | no                                      |
| `stop`       | yes           | no             | yes                              | yes                                     |
| `exception`  | yes           | no             | no                               | yes                                     |
| `skip`       | sometimes     | yes            | no                               | no                                      |

## Flow

{{SEQUENCE_CODE_BLOCK}}

## Static Graph

{{STATIC_GRAPH_SECTION}}

## Passing Demo

{{PASSING_DEMO_SECTION}}

## Failing Demo

{{FAILING_DEMO_SECTION}}

## Stop Demo

{{STOP_DEMO_SECTION}}

## Exception Demo

{{EXCEPTION_DEMO_SECTION}}
