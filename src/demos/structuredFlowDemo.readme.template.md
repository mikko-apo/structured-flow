# structured-flow

Model business rules and validation pipelines with typed steps, branches, and execution results.

Structured flow gives you:

- Step-by-step execution with readable ids and descriptions
- Typed `data` and optional `ctx` across the whole flow
- Branching into child flows without leaking child payloads back to the parent flow
- Recorded execution results that can be rendered as HTML tables or Mermaid graphs
- Metadata helpers for reusable step ids and descriptions
- Flow-level metadata resolution for final step ids and descriptions
- Runtime payload remapping through `map`

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

createSyncFlow(stepId, stepFn, stepOptions?)
createAsyncFlow(stepId, stepFn, stepOptions?)

createSyncFlow(select, branches, branchOptions?)
createAsyncFlow(select, branches, branchOptions?)
```

Use the empty generic form when your first `step()` should define the flow. Use the config form when you want flow-level
metadata, a flow-level `resolver`, or a flow-level `map`. Use the positional forms for short one-step or one-branch
flows.

## Flow options

Flow config currently supports:

- `name?: string`: stored on the built flow as metadata
- `description?: string`: stored on the built flow as metadata
- `resolver?: (stepId) => string | RuleId | { id: string; description?: string }`: maps each `string`, `RuleId`, or `Step` id to its final recorded metadata
- `map?: ({ id, data, ctx, stepOptions, params }) => object`: augments callback params, and can optionally return `fnInput: [data, params]` to override the callback signature

`resolver` is metadata-only and is configured on the flow builder. `step()` and `branch()` do not have resolver options.
`map` is runtime-only. By default it augments the second callback parameter while `data` remains the flow's accumulated
data object. When a map returns `fnInput: [data, params]`, that tuple becomes the callback signature for that node.

## Step and branch options

`step()` and `branch()` accept option objects:

```ts
{
  description?: string
  status?: {
    error?: 'ignore' | 'exception'
    exception?: 'error'
  }
  map?: ({ id, data, ctx, stepOptions, params }) => object & {
    fnInput?: [data: object, params: object]
  }
}
```

The flow-level `map` runs before a step-level or branch-level `map`.

## Runtime behavior

- Step callbacks are invoked as `fn(data, params)`
- Branch selectors are invoked as `select(data, params)`
- Without `map`, `params` is `{ ctx }`
- With `map`, its returned fields are merged into `params` and `params.ctx` stays available
- With `map().fnInput`, the callback is invoked with that explicit `[data, params]` tuple instead
- `withContext<Ctx>()` enables `flow.run(data, ctx)` and types downstream callbacks accordingly
- Plain object returns record `ok` payloads; use `ok()`, `error()`, `stop()`, `skip()`, or `exception()` for explicit statuses

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
- branch steps include `selectedBranchKeys` and nested `branches`
- helper utilities such as `collectFailedStepIds()` and `convertResultNode()` can flatten or normalize result inspection

# Examples

## Core API Example

This example uses the short positional form. The first step infers the flow input type and later steps build on the
returned data.

{{CORE_API_CODE_BLOCK}}

### Flow Layout

{{CORE_API_FLOW_HTML}}

### Static Graph

{{CORE_API_STATIC_GRAPH}}

### Example Run

{{CORE_API_ok_FULL_TABLE}}

## Flow Metadata Example

This flow is created with flow-level `name` and `description`. Those values are stored on the built flow and can be used
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
