# structured-flow

Need to manage hundreds of business logic validation rules in code? Tired of scattered docs and complex code?
structured-flow helps you structure logic and visualize execution.

<!-- TOC -->
* [structured-flow](#structured-flow)
* [Structured Flow API Example](#structured-flow-api-example)
  * [Flow And Step Execution](#flow-and-step-execution)
  * [Flow](#flow)
  * [Static Graph](#static-graph)
  * [Passing Demo](#passing-demo)
  * [Failing Demo](#failing-demo)
  * [Stop Demo](#stop-demo)
  * [Exception Demo](#exception-demo)
* [branch() examples](#branch-examples)
  * [One Of Three Branches](#one-of-three-branches)
  * [Two Of Three Branches](#two-of-three-branches)
  * [Skipped Branch](#skipped-branch)
<!-- TOC -->

# Structured Flow API Example

This example shows the intended flow of the sequence API and two concrete runs of the same sequence.

- `createSyncFlow<Ctx, Info>()` starts a builder that accepts only synchronous step functions.
- `createAsyncFlow<Ctx, Info>()` starts a builder that accepts synchronous or async step functions.
- `.step(id, description, fn)` appends a step that can extend ctx and return structured step results.
- `.branch(id, select, branches)` appends a branch step that runs one or more child flows selected from `branches`.
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

Branch steps call `select(ctx)` to choose which child flow or flows to run. `select` can return a single branch key,
multiple keys, or a direct step result value like `skip`, `error`, `stop`, or `exception`. Returning an unknown key
fails the branch step. Child flows always start from the parent step's current ctx, but their added ctx fields stay
inside the child flow result and are not merged back into the parent ctx. Nested child step results are recorded under
the parent step result's `branches` array.

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

# branch() examples

## One Of Three Branches

This run selects exactly one branch from three branches.

{{BRANCH_ONE_OF_THREE_CODE_BLOCK}}

{{BRANCH_ONE_OF_THREE_DEMO_SECTION}}

## Two Of Three Branches

This run selects two branches from three branches and records each branch result separately.

{{BRANCH_TWO_OF_THREE_CODE_BLOCK}}

{{BRANCH_TWO_OF_THREE_DEMO_SECTION}}

## Skipped Branch

This run returns `skip` directly from the selector, so no child branch flow is executed.

{{BRANCH_SKIP_CODE_BLOCK}}

{{BRANCH_SKIP_DEMO_SECTION}}
