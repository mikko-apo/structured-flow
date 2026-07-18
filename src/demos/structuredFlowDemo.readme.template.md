# structured-flow

Model business rules and validation pipelines with typed steps, branches, and execution results.

Structured flow gives you:

- Step-by-step execution with readable ids and descriptions
- Typed `data` and optional `ctx` across the whole flow
- Branching into child flows without leaking child payloads back to the parent flow
- Recorded execution results that can be rendered as HTML tables or Mermaid graphs
- Metadata hooks for step ids and descriptions through `resolver`
- Runtime payload remapping through `map`

{{TOC}}

# Core API

## Factory variants

`createSyncFlow()` and `createAsyncFlow()` support a few shapes:

```ts
createSyncFlow<Data>()
createAsyncFlow<Data>()

createSyncFlow<StepId, Data>({
  name,
  description,
  resolver,
  map,
})

createSyncFlow(stepId, stepFn, stepOptions?)
createAsyncFlow(stepId, stepFn, stepOptions?)

createSyncFlow(branchId, select, branches, stepOptions?)
createAsyncFlow(branchId, select, branches, stepOptions?)
```

Use the empty generic form when your first `step()` should define the flow. Use the config form when you want flow-level
metadata or typed object step ids. Use the positional forms for short one-step or one-branch flows.

## Flow options

Flow config currently supports:

- `name?: string`: stored on the built flow as metadata
- `description?: string`: stored on the built flow as metadata
- `resolver?: ({ id, description }) => ({ id, description? })`: resolves metadata for object-valued step ids
- `map?: ({ id, data, ctx, stepOptions, params }) => object`: augments callback params, and can optionally return `fnInput: [data, params]` to override the callback signature

`resolver` is metadata-only. It does not change runtime payloads. `map` is runtime-only. By default it augments the
second callback parameter while `data` remains the flow's accumulated data object. When a map returns
`fnInput: [data, params]`, that tuple becomes the callback signature for that node.

## Step and branch options

`step()` and `branch()` both accept `StepOptions`:

```ts
{
  description?: string
  status?: {
    error?: 'ignore' | 'exception'
    exception?: 'error'
  }
  resolver?: ({ id, description }) => ({ id, description? })
  map?: ({ id, data, ctx, stepOptions, params }) => object & {
    fnInput?: [data: object, params: object]
  }
}
```

The flow-level resolver runs by default. A step-level or branch-level resolver can override the metadata for that node.
The flow-level `map` runs before a step-level or branch-level `map`.

## Runtime behavior

- Step callbacks are invoked as `fn(data, params)`
- Branch selectors are invoked as `select(data, params)`
- Without `map`, `params` is `{ ctx }`
- With `map`, its returned fields are merged into `params` and `params.ctx` stays available
- With `map().fnInput`, the callback is invoked with that explicit `[data, params]` tuple instead
- `withContext<Ctx>()` enables `flow.run(data, ctx)` and types downstream callbacks accordingly
- `stepResult({ status, ...payload })` records status and keeps non-status fields as result payload

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

## Resolver And Branch Example

This example uses object-valued step ids with a flow-level resolver. Each object provides the source metadata and can
also provide a default `fn`. The resolver turns that object into the stored `{ id, description }` metadata. A
step-level resolver can override the flow-level resolver for one node when needed.

{{RESOLVER_FLOW_CODE_BLOCK}}

### Flow Layout

{{RESOLVER_FLOW_FLOW_HTML}}

### Static Graph

{{RESOLVER_FLOW_STATIC_GRAPH}}

### Example Run

{{RESOLVER_FLOW_manual_FULL_TABLE}}

{{LEAF_FLOWS_HTML}}
