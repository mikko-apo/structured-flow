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

createSyncFlow<Data>({
  name,
  description,
  resolver,
  map,
})

createSyncFlow(stepId, stepFn, stepOptions ?)
createAsyncFlow(stepId, stepFn, stepOptions ?)

createSyncFlow(select, branches, branchOptions ?)
createAsyncFlow(select, branches, branchOptions ?)

createSyncFlow(branches, branchOptions ?)
createAsyncFlow(branches, branchOptions ?)
```

Use the empty generic form when your first `step()` should define the flow. Use the config form when you want flow-level
metadata, a flow-level `resolver`, or a flow-level `map`. Use the positional forms for short one-step or one-branch
flows. When a branch is created without a selector, every branch flow runs.

## Flow options

Flow config currently supports:

- `name?: string`: stored on the flow as metadata
- `description?: string`: stored on the flow as metadata
- `resolver?: (stepId) => string | RuleId | { id: string; description?: string }`: maps each `string`, `RuleId`, or
  `Rule` id to its final recorded metadata
- `map?: ({ id, data, ctx, stepOptions, params }) => object`: augments callback params, and can optionally return
  `fnInput: [data, params]` to override the callback signature

`resolver` is metadata-only and is configured on the flow. `step()` and `branch()` do not have resolver options.
`map` is runtime-only. By default it augments the second callback parameter while `data` remains the flow's accumulated
data object. When a map returns `fnInput: [data, params]`, that tuple becomes the callback signature for that node.

## Step and branch options

`step()` and `branch()` accept option objects:

```ts
{
  description ? : string
  status ? : {
    error? : 'ignore' | 'exception'
    exception? : 'error'
  }
  map ? : ({id, data, ctx, stepOptions, params}) => object & {
    fnInput? : [data
:
  object, params
:
  object
]
}
}
```

The flow-level `map` runs before a step-level or branch-level `map`.
For `branch()`, `name` is display-only. Set `ruleId` only when the branch wrapper itself should have a public id and be
included by `flattenFailedStepResults()` when it fails.

## Runtime behavior

- Step callbacks are invoked as `fn(data, params)`
- Branch selectors are invoked as `select(data, params)`
- Without `map`, `params` is `{ ctx }`
- With `map`, its returned fields are merged into `params` and `params.ctx` stays available
- With `map().fnInput`, the callback is invoked with that explicit `[data, params]` tuple instead
- `withContext<Ctx>()` enables `flow.run(data, ctx)` and types downstream callbacks accordingly
- Plain object returns record `ok` payloads; use `ok()`, `error()`, `stop()`, `skip()`, or `exception()` for explicit
  statuses

Status handling:

- `ok` or omitted: continue and merge returned fields into downstream data
- `error`: record failure and continue
- `stop`: stop execution and mark remaining steps as `skip`
- `exception`: recorded when a step throws, unless remapped through `status.exception`
- `skip`: record a skipped result

## Result model

`flow.run(...)` returns `FlowResult`.

- `result.status` is the overall flow status
- `result.stepResults` contains recorded `StepResult` entries in execution order
- branch steps include `selectedBranchKeys` only when a selector picks a subset; branches that run every child flow only include nested `branches`
- helper utilities such as `flattenFailedStepResults()` and `convertResultNode()` can flatten or normalize result
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

This flow is created with flow-level `name` and `description`. Those values are stored on the flow and can be used
by surrounding tooling or documentation.

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

This flow demonstrates runtime params augmentation and `fnInput`. The flow-level `map` adds derived fields to the
`params` argument and then overrides the callback signature with `fnInput`.

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
