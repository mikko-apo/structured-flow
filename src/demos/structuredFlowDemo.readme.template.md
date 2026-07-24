# structured-flow

Model business rules and validation pipelines with typed steps, branches, and execution results.

Structured flow gives you:

- Simple API for modeling complex structures
- Automatically generated documentation and graphs of the validation flow. You get documentation before execution:
  graphs and HTML-tables. And after execution you can render graphs based on logged events
- A way to define a flow of steps with a human-readable API and descriptions
- API that enforces correctness and scales to hundreds of rules
- Ready made tools to visualize and document the flow before and after execution
    - Mermaid graphs: the flow and flow results
    - Markdown HTML tables
- Evidence of processesed rules
- Full type enforcement: types are enforced for rule functions and flows
- Promotes splitting the program code in to smaller functions. Instead of a deep nested validation logic, there's small
  functions that are called by the flow

Contents:

{{TOC}}

# Core API

## Factory variants

`createSyncFlow()` and `createAsyncFlow()` support a few shapes:

```ts
createSyncFlow<Data>()
createAsyncFlow<Data>()

createSyncFlow(ruleOrFlowOptionsOrCombinedBranchOptions)
createSyncFlow(rule, { ...flowOptions, step: stepOptions })
createSyncFlow(ruleIdOrString, stepFn, { ...flowOptions, step: stepOptions })

createAsyncFlow(ruleOrFlowOptionsOrCombinedBranchOptions)
createAsyncFlow(rule, { ...flowOptions, step: stepOptions })
createAsyncFlow(ruleIdOrString, stepFn, { ...flowOptions, step: stepOptions })
```

Use the empty generic form when your first `step()` should define the flow. Use the config form when you want flow-level
metadata, a flow-level `step.resolver`, or a flow-level `step.map`. Step factories retain their positional forms. Branches use one
object containing flow options at the root and branch options under `branch`. The nested `branch` object contains mandatory
`branches`, optional `init`, and branch options. When a branch is created without `init`, every branch flow runs.

```ts
flow.branch({ branches, init, name: 'selected branch' })
createSyncFlow({
  mapResult,
  branch: { branches, init, name: 'initial branch' },
})
```

In combined factory options, flow metadata and flow-wide `resolver`, `map`, `mapResult`, and `trueIsFail` are root
properties. Direct step options stay under `step`, and direct branch options stay under `branch`.

## Flow options

Flow config currently supports:

- `syncMode: boolean`: selected by `createSyncFlow()` or `createAsyncFlow()`
- `allowContext: boolean`: starts as `false` and becomes `true` after `withContext()`
- `name?: string`: stored on the flow as metadata
- `description?: string`: stored on the flow as metadata
- `step?.resolver?: (stepId) => string | RuleId | { id: string; description?: string }`: maps each step id to its final
  recorded metadata
- `step?.map?: ({ stepInfo, processingState, data, ctx }) => { data, ctx }`: overrides callback data and context
- `step?.mapResult?: ({ stepInfo, processingState, data, ctx, result }) => result`: converts each raw step return before
  normalization
- `step?.trueIsFail?: boolean`: makes boolean validation results use `true → fail` and `false → ok`

These flow-wide step defaults are configured under `step`. A direct step can override `trueIsFail` and `mapResult`.

## Step and branch options

`step()` accepts:

```ts
step(rule, options)

step({
  rule: Rule | RuleId | string
  fn ? : (data, params) => object | boolean
  init ? : ({stepInfo, processingState, data, ctx}) => {
    data: object
    ctx: unknown
  }
  // other step options
})
```

The object form requires `fn` for a `RuleId` or string. For a `Rule`, `fn` is optional and overrides the function carried
by the Rule when supplied.

Step options are:

```ts
{
  description ? : string
  status ? : {
    fail? : 'ignore' | 'exception'
    exception? : 'fail'
  }
  trueIsFail ? : boolean
  init ? : ({stepInfo, processingState, data, ctx}) => {
    data: object
    ctx: unknown
  }
  mapResult ? : ({stepInfo, processingState, data, ctx, result}) => object | boolean | undefined
}
```

`branch()` accepts:

```ts
{
  branches: Record<PropertyKey, Flow>
  init ? : ({stepInfo, processingState, data, ctx}) => BranchInitResult
  ruleId ? : string | { id: string; description?: string }
  name ? : string
  description ? : string
  path ? : string
  status ? : {
    fail? : 'ignore' | 'exception'
    exception? : 'fail'
  }
}
```

The flow-level `step.map` runs before a direct step `init`. For `branch()`, `name` is display-only. Set `ruleId` only when the
branch wrapper itself should have a public id and be included by `flattenStepResults()` when it fails.

## Runtime behavior

- Step callbacks are invoked as `fn(data, params)`
- Branch initializers are invoked as `init({ stepInfo, processingState, data, ctx })`
- Without step `init`, `params` is `{ ctx }`
- With step `init`, the callback is invoked as `fn(initialized.data, { ctx: initialized.ctx })`
- `withContext<Ctx>()` enables `flow.run(data, ctx)` and types downstream callbacks accordingly
- Async flows await step functions, branch initializers, `init`, `map`, and `mapResult`; sync flows only accept synchronous
  versions of those callbacks
- Plain object returns record `ok` payloads; use `ok()`, `fail()`, `stop()`, `skip()`, or `exception()` for explicit
  statuses
- Boolean returns use `true → ok` and `false → fail` by default; `trueIsFail` reverses that interpretation

Status handling:

- `ok` or omitted: continue and merge returned fields into downstream data
- `fail`: record failure and continue
- `stop`: stop execution and mark remaining steps as `skip`
- `exception`: recorded when a step throws, unless remapped through `status.exception`
- `skip`: record a skipped result

## Result model

`flow.run(...)` returns `FlowResult`.

- `result.status` is the overall flow status
- `result.stepResults` contains recorded `StepResult` entries in execution order
- branch steps include `selectedBranchKeys` only when a selector picks a subset; branches that run every child flow only
  include nested `branches`
- `flattenStepResults()` defaults to failed results; its optional callback receives
  `{ failed, flattenedResult, stepResult }` and can map or filter every flattened step by returning an item or
  `undefined`
- `convertResultNode()` can normalize the result tree
  inspection

# Examples

## Core API Example

This example defines reusable `rule()` helpers, builds a `personChecks` flow from them, and composes that flow into a
larger household flow with branches.

{{CORE_API_CODE_BLOCK}}

### Flow Layout

{{CORE_API_FLOW_HTML}}

### Static Graph

{{CORE_API_STATIC_GRAPH}}

### No Kids Run

{{CORE_API_no_kids_FULL_TABLE}}

### Two Kids Run

{{CORE_API_two_kids_FULL_TABLE}}

### Missing Name Run

{{CORE_API_missing_name_FULL_TABLE}}

## Flow Metadata Example

This flow is created with flow-level `name` and `description`. Those values are stored on the flow and can be used by
surrounding tooling or documentation.

{{FLOW_METADATA_CODE_BLOCK}}

### Flow Layout

{{FLOW_METADATA_FLOW_HTML}}

### Static Graph

{{FLOW_METADATA_STATIC_GRAPH}}

### Example Run

{{FLOW_METADATA_ok_FULL_TABLE}}

## Context Example

This flow uses `withContext()` so `flow.run(data, ctx)` passes a separate context object to each callback through the
`params.ctx` field.

{{CONTEXT_FLOW_CODE_BLOCK}}

### Flow Layout

{{CONTEXT_FLOW_FLOW_HTML}}

### Static Graph

{{CONTEXT_FLOW_STATIC_GRAPH}}

### Example Run

{{CONTEXT_FLOW_reviewer_FULL_TABLE}}

## Map Example

This flow demonstrates mapped callback data and ctx. The flow-level `step.map` derives a callback-shaped `data` object and a
callback-specific `ctx` object for each step.

{{MAP_FLOW_CODE_BLOCK}}

### Flow Layout

{{MAP_FLOW_FLOW_HTML}}

### Static Graph

{{MAP_FLOW_STATIC_GRAPH}}

### Example Run

{{MAP_FLOW_manual_FULL_TABLE}}

## Rule Helper And Branch Example

This example uses `ruleId()` so ids and descriptions can be defined together while step functions remain explicit.

{{RULE_FLOW_CODE_BLOCK}}

### Flow Layout

{{RULE_FLOW_FLOW_HTML}}

### Static Graph

{{RULE_FLOW_STATIC_GRAPH}}

### Example Run

{{RULE_FLOW_manual_FULL_TABLE}}

{{LEAF_FLOWS_HTML}}
