# structured-flow

Model business rules or validation steps with code in a structured way.

<!-- TOC -->
* [structured-flow](#structured-flow)
* [Core API surface](#core-api-surface)
  * [Flow And Step Execution](#flow-and-step-execution)
  * [Handling results](#handling-results)
  * [Rendering results](#rendering-results)
* [Code examples](#code-examples)
  * [Structured StepDescription](#structured-stepdescription)
  * [Step results and execution visualized](#step-results-and-execution-visualized)
    * [Flow](#flow)
    * [Static Graph](#static-graph)
    * [Passing Demo](#passing-demo)
    * [Failing Demo](#failing-demo)
    * [Stop Demo](#stop-demo)
    * [Exception Demo](#exception-demo)
  * [branch() examples](#branch-examples)
    * [One Of Three Branches](#one-of-three-branches)
    * [Two Of Three Branches](#two-of-three-branches)
    * [Nested Branch](#nested-branch)
    * [Skipped Branch](#skipped-branch)
<!-- TOC -->

# Core API

```ts
type SubmittedForm = { id: string }
type Occupancy = { id: string }

function getOccupancies(_ctx: { form: SubmittedForm }) {
  return {
    occupancies: [] as Occupancy[],
  }
}

function verifyOccupancyCount(_ctx: { form: SubmittedForm; occupancies: Occupancy[] }) {
  return stepResult({
    result: 'ok',
    info: 'Count looks good.',
  })
}

async function crossCheckFormAndOccupancies(_ctx: { form: SubmittedForm; occupancies: Occupancy[] }) {
  return stepResult({
    result: 'ok',
    info: 'Cross-check passed.',
  })
}

// Ctx is inferred from the first step function parameter. Here it becomes `{ form: SubmittedForm }`.
const validations = createAsyncFlow('IC10', 'Get linked occupancy records', getOccupancies)
  // Fields returned from a step are added to the ctx for following steps when the result is `ok` or `stop`.
  // `getOccupancies()` adds `occupancies`, so later steps receive `{ form, occupancies }`.
  .step('IC25', 'Count the recovered occupancy trail', verifyOccupancyCount)
  .step('IC30', 'Cross-check the submitted form against the occupancy trail', crossCheckFormAndOccupancies)
  .build()

// run() returns `FlowResult` which can be used to inspect the results
const result = await validations.run({form: {id: '200'}})

if (!result.ok) {
  throw new Error(`Validation failed: ${result.failedStepIds().join(', ')}`)
}
```
## Flow And Step Execution

Each step receives the initial or acculated context object and each step function returns a `StepResult`.

`StepResult` contains the following fields:
- `result` controls execution of the flow and the execution of the following steps
  - `ok` or undefined mean that the step was completed successfully.
  - `error` means that the step failed and execution continues.
  - Thrown errors are recorded as `exception`m but exception can be returned with code also
  - `stop` means that the step failed and execution stops.
  - `skip` does not continue
- `info` is copied into `stepResults`
- other returned fields are added to the ctx

A branch step calls the selector function and can return one key, many keys, or a direct status like `skip`, `error`, `stop`, or
`exception`. Child flows run from the parent ctx, but their ctx additions stay inside the branch result.

The table below shows how each recorded `result` affects execution and ctx updates:

| Result value      | Step executed | Flow continues | Returned fields added to context | Remaining steps auto-recorded as `skip` |
|-------------------|---------------|----------------|----------------------------------|-----------------------------------------|
| `ok` or undefined | yes           | yes            | yes                              | no                                      |
| `error`           | yes           | yes            | no                               | no                                      |
| `stop`            | yes           | no             | yes                              | yes                                     |
| `exception`       | yes           | no             | no                               | yes                                     |
| `skip`            | sometimes     | yes            | no                               | no                                      |

## Handling results

- `FlowResult` exposes `ok`, `finalCtx`, `stepResults`, and `failedStepIds()`.
- Use `result.ok` for the top-level pass/fail check.
- Use `result.failedStepIds()` to list the failed step ids.
- Each `stepResult` records `id`, `result`, optional `info`, optional `addToCtx`, and optional nested `branches`.
- `result.enrichResult()` returns an enriched results object which contains the step's `description` to each recorded step result, including nested branch results.

## Rendering results

- `renderProcessAsMermaidGraph(flow)` renders a static graph from a builder or built flow.
- `renderProcessAsMermaidGraph(result)` renders an executed graph with step statuses and `info`.

# Code examples

## Structured StepDescription

This example uses an object-valued `StepDescription` for both `step()` and `branch()`. The generated JSON below shows
the stored flow definition.

{{STRUCTURED_STEP_DESCRIPTION_CODE_BLOCK}}

<p><strong>Internal flow configuration JSON</strong></p>

{{STRUCTURED_STEP_DESCRIPTION_FLOW_JSON}}

{{STRUCTURED_STEP_DESCRIPTION_DEMO_SECTION}}

## Step results and execution visualized

### Flow

This is the source flow used by the graph and run examples below.

{{SEQUENCE_CODE_BLOCK}}

### Static Graph

This is the same flow before execution.

{{STATIC_GRAPH_SECTION}}

### Passing Demo

Happy path: every step runs and the flow ends with `ok`.

{{PASSING_DEMO_SECTION}}

### Failing Demo

A step returns `error`. Execution continues, but the overall result is failed.

{{FAILING_DEMO_SECTION}}

### Stop Demo

A step returns `stop`, so later steps are recorded as `skip`.

{{STOP_DEMO_SECTION}}

### Exception Demo

An exception ends the flow immediately and marks the rest as `skip`.

{{EXCEPTION_DEMO_SECTION}}

## branch() examples

### One Of Three Branches

Selector returns one branch key.

{{BRANCH_ONE_OF_THREE_CODE_BLOCK}}

{{BRANCH_ONE_OF_THREE_DEMO_SECTION}}

### Two Of Three Branches

Selector returns multiple branch keys.

{{BRANCH_TWO_OF_THREE_CODE_BLOCK}}

{{BRANCH_TWO_OF_THREE_DEMO_SECTION}}

### Nested Branch

A branch can route into another branch flow.

{{NESTED_BRANCH_CODE_BLOCK}}

{{NESTED_BRANCH_DEMO_SECTION}}

### Skipped Branch

Selector returns 'skip' status instead of branch keys.

{{BRANCH_SKIP_CODE_BLOCK}}

{{BRANCH_SKIP_DEMO_SECTION}}
