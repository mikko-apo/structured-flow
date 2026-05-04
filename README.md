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

```ts
type SubmittedForm = { id: string }
type Occupancy = { id: string }

function getOccupancies({ form }: { form: SubmittedForm }) {
  return {
    occupancies: form.id === '123' ? [{ id: 'a' + form.id }] : [{ id: 'a' + form.id }, { id: 'b' + form.id }],
  }
}

function verifyOccupancyCount({ form, occupancies }: { form: SubmittedForm; occupancies: Occupancy[] }) {
  if (form.id === '300') {
    return stepResult({
      result: 'stop',
      info: 'The first two records are enough here, so the sequence can finish early.',
    })
  }

  if (form.id === '400') {
    return stepResult({
      result: 'exception',
      info: 'A contradictory record was discovered, so the sequence stops immediately.',
    })
  }

  return stepResult({
    result: occupancies.length === 2 ? 'ok' : 'error',
    info:
      occupancies.length === 2
        ? 'Recovered the full two-record occupancy trail.'
        : 'Expected two occupancy records but found an incomplete trail.',
  })
}

async function crossCheckFormAndOccupancies({ form }: { form: SubmittedForm; occupancies: Occupancy[] }) {
  return stepResult({
    result: form.id === '400' ? 'error' : 'ok',
    info:
      form.id === '123'
        ? 'The submitted form is acceptable, but the occupancy trail is still incomplete.'
        : 'The submitted form and occupancy trail tell a consistent story.',
  })
}

const sequence = createAsync<{ form: SubmittedForm }, string>()
  .step('IC10', 'Get linked occupancy records', getOccupancies)
  .step('IC25', 'Count the recovered occupancy trail and insist on exactly two records', verifyOccupancyCount)
  .step('IC30', 'Cross-check the submitted form against the recovered occupancy trail', crossCheckFormAndOccupancies)
  .build()
```

## Static Graph

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;"><div><p><strong>Result JSON</strong><br>Static sequence view does not have a run result yet.</p></div><div><div>

<!-- structured-process-demo:static-graph:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["IC10: Get linked occupancy records"]
  step_0 --> step_1
  step_1["IC25: Count the recovered occupancy trail and insist on exactly two records"]
  step_1 --> step_2
  step_2["IC30: Cross-check the submitted form against the recovered occupancy trail"]
  step_2 --> done
  done([Done])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
```
<!-- structured-process-demo:static-graph:mermaid:end -->

</div></div><div><!-- structured-process-demo:static-graph:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th></tr></thead><tbody><tr><td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC10</td><td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Get linked occupancy records</td></tr><tr><td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC25</td><td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Count the recovered occupancy trail and insist on exactly two records</td></tr><tr><td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC30</td><td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Cross-check the submitted form against the recovered occupancy trail</td></tr></tbody></table>
<!-- structured-process-demo:static-graph:html-table:end --></div></div>

## Passing Demo

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;"><div><div>

<p><strong>Init JSON</strong></p>
<!-- structured-process-demo:passing-demo-init:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;form&quot;: {
    &quot;id&quot;: &quot;200&quot;
  }
}</code>
</pre>
<!-- structured-process-demo:passing-demo-init:json:end -->

<p><strong>Result JSON</strong></p>
<!-- structured-process-demo:passing-demo-result:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;ok&quot;: true,
  &quot;failedStepIds&quot;: [],
  &quot;stepResults&quot;: [
    {
      &quot;id&quot;: &quot;IC10&quot;,
      &quot;result&quot;: &quot;ok&quot;
    },
    {
      &quot;id&quot;: &quot;IC25&quot;,
      &quot;result&quot;: &quot;ok&quot;,
      &quot;info&quot;: &quot;Recovered the full two-record occupancy trail.&quot;
    },
    {
      &quot;id&quot;: &quot;IC30&quot;,
      &quot;result&quot;: &quot;ok&quot;,
      &quot;info&quot;: &quot;The submitted form and occupancy trail tell a consistent story.&quot;
    }
  ],
  &quot;ctx&quot;: {
    &quot;form&quot;: {
      &quot;id&quot;: &quot;200&quot;
    },
    &quot;occupancies&quot;: [
      {
        &quot;id&quot;: &quot;a200&quot;
      },
      {
        &quot;id&quot;: &quot;b200&quot;
      }
    ]
  }
}</code>
</pre>
<!-- structured-process-demo:passing-demo-result:json:end -->

</div></div><div><div>

<!-- structured-process-demo:passing-demo:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["IC10: Get linked occupancy records
[ok]"]
  step_0 --> step_1
  step_1["IC25: Count the recovered occupancy trail and insist on exactly two records
[ok]
Recovered the full two-record occupancy trail."]
  step_1 --> step_2
  step_2["IC30: Cross-check the submitted form against the recovered occupancy trail
[ok]
The submitted form and occupancy trail tell a consistent story."]
  step_2 --> done
  done([Done])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
  class step_0 success
  class step_1 success
  class step_2 success
  class start executed
  class done success
```
<!-- structured-process-demo:passing-demo:mermaid:end -->

</div></div><div><p><strong>Overall outcome:</strong> <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">successful sequence run</span><br><strong>Failed steps:</strong> none</p>
<!-- structured-process-demo:passing-demo:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th></tr></thead>
<tbody><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC10</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Get linked occupancy records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"></td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC25</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Count the recovered occupancy trail and insist on exactly two records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Recovered the full two-record occupancy trail.</td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC30</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Cross-check the submitted form against the recovered occupancy trail</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">The submitted form and occupancy trail tell a consistent story.</td>
</tr></tbody>
</table>
<!-- structured-process-demo:passing-demo:html-table:end --></div></div>

## Failing Demo

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;"><div><div>

<p><strong>Init JSON</strong></p>
<!-- structured-process-demo:failing-demo-init:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;form&quot;: {
    &quot;id&quot;: &quot;123&quot;
  }
}</code>
</pre>
<!-- structured-process-demo:failing-demo-init:json:end -->

<p><strong>Result JSON</strong></p>
<!-- structured-process-demo:failing-demo-result:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;ok&quot;: false,
  &quot;failedStepIds&quot;: [
    &quot;IC25&quot;
  ],
  &quot;stepResults&quot;: [
    {
      &quot;id&quot;: &quot;IC10&quot;,
      &quot;result&quot;: &quot;ok&quot;
    },
    {
      &quot;id&quot;: &quot;IC25&quot;,
      &quot;result&quot;: &quot;error&quot;,
      &quot;info&quot;: &quot;Expected two occupancy records but found an incomplete trail.&quot;
    },
    {
      &quot;id&quot;: &quot;IC30&quot;,
      &quot;result&quot;: &quot;ok&quot;,
      &quot;info&quot;: &quot;The submitted form is acceptable, but the occupancy trail is still incomplete.&quot;
    }
  ],
  &quot;ctx&quot;: {
    &quot;form&quot;: {
      &quot;id&quot;: &quot;123&quot;
    },
    &quot;occupancies&quot;: [
      {
        &quot;id&quot;: &quot;a123&quot;
      }
    ]
  }
}</code>
</pre>
<!-- structured-process-demo:failing-demo-result:json:end -->

</div></div><div><div>

<!-- structured-process-demo:failing-demo:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["IC10: Get linked occupancy records
[ok]"]
  step_0 --> step_1
  step_1["IC25: Count the recovered occupancy trail and insist on exactly two records
[error]
Expected two occupancy records but found an incomplete trail."]
  step_1 --> step_2
  step_2["IC30: Cross-check the submitted form against the recovered occupancy trail
[ok]
The submitted form is acceptable, but the occupancy trail is still incomplete."]
  step_2 --> done
  done([Completed with Errors])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
  class step_0 success
  class step_1 failure
  class step_2 success
  class start executed
  class done failure
```
<!-- structured-process-demo:failing-demo:mermaid:end -->

</div></div><div><p><strong>Overall outcome:</strong> <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;">completed with errors</span><br><strong>Failed steps:</strong> IC25</p>
<!-- structured-process-demo:failing-demo:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th></tr></thead>
<tbody><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC10</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Get linked occupancy records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"></td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC25</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Count the recovered occupancy trail and insist on exactly two records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;">error</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Expected two occupancy records but found an incomplete trail.</td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC30</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Cross-check the submitted form against the recovered occupancy trail</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">The submitted form is acceptable, but the occupancy trail is still incomplete.</td>
</tr></tbody>
</table>
<!-- structured-process-demo:failing-demo:html-table:end --></div></div>

## Stop Demo

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;"><div><div>

<p><strong>Init JSON</strong></p>
<!-- structured-process-demo:stop-demo-init:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;form&quot;: {
    &quot;id&quot;: &quot;300&quot;
  }
}</code>
</pre>
<!-- structured-process-demo:stop-demo-init:json:end -->

<p><strong>Result JSON</strong></p>
<!-- structured-process-demo:stop-demo-result:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;ok&quot;: true,
  &quot;failedStepIds&quot;: [],
  &quot;stepResults&quot;: [
    {
      &quot;id&quot;: &quot;IC10&quot;,
      &quot;result&quot;: &quot;ok&quot;
    },
    {
      &quot;id&quot;: &quot;IC25&quot;,
      &quot;result&quot;: &quot;stop&quot;,
      &quot;info&quot;: &quot;The first two records are enough here, so the sequence can finish early.&quot;
    },
    {
      &quot;id&quot;: &quot;IC30&quot;,
      &quot;result&quot;: &quot;skip&quot;
    }
  ],
  &quot;ctx&quot;: {
    &quot;form&quot;: {
      &quot;id&quot;: &quot;300&quot;
    },
    &quot;occupancies&quot;: [
      {
        &quot;id&quot;: &quot;a300&quot;
      },
      {
        &quot;id&quot;: &quot;b300&quot;
      }
    ]
  }
}</code>
</pre>
<!-- structured-process-demo:stop-demo-result:json:end -->

</div></div><div><div>

<!-- structured-process-demo:stop-demo:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["IC10: Get linked occupancy records
[ok]"]
  step_0 --> step_1
  step_1["IC25: Count the recovered occupancy trail and insist on exactly two records
[stop]
The first two records are enough here, so the sequence can finish early."]
  step_1 --> step_2
  step_2["IC30: Cross-check the submitted form against the recovered occupancy trail
[skip]"]
  step_2 --> done
  done([Completed Early])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
  class step_0 success
  class step_1 complete
  class step_2 neutral
  class start executed
  class done success
```
<!-- structured-process-demo:stop-demo:mermaid:end -->

</div></div><div><p><strong>Overall outcome:</strong> <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#f0fdf4;color:#166534;border:1px solid #86efac;">completed early</span><br><strong>Failed steps:</strong> none</p>
<!-- structured-process-demo:stop-demo:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th></tr></thead>
<tbody><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC10</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Get linked occupancy records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"></td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC25</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Count the recovered occupancy trail and insist on exactly two records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#f0fdf4;color:#166534;border:1px solid #86efac;">stop</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">The first two records are enough here, so the sequence can finish early.</td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC30</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Cross-check the submitted form against the recovered occupancy trail</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#f8fafc;color:#475569;border:1px solid #cbd5e1;">skip</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"></td>
</tr></tbody>
</table>
<!-- structured-process-demo:stop-demo:html-table:end --></div></div>

## Exception Demo

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;"><div><div>

<p><strong>Init JSON</strong></p>
<!-- structured-process-demo:exception-demo-init:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;form&quot;: {
    &quot;id&quot;: &quot;400&quot;
  }
}</code>
</pre>
<!-- structured-process-demo:exception-demo-init:json:end -->

<p><strong>Result JSON</strong></p>
<!-- structured-process-demo:exception-demo-result:json:start -->
<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">
<code>{
  &quot;ok&quot;: false,
  &quot;failedStepIds&quot;: [
    &quot;IC25&quot;
  ],
  &quot;stepResults&quot;: [
    {
      &quot;id&quot;: &quot;IC10&quot;,
      &quot;result&quot;: &quot;ok&quot;
    },
    {
      &quot;id&quot;: &quot;IC25&quot;,
      &quot;result&quot;: &quot;exception&quot;,
      &quot;info&quot;: &quot;A contradictory record was discovered, so the sequence stops immediately.&quot;
    },
    {
      &quot;id&quot;: &quot;IC30&quot;,
      &quot;result&quot;: &quot;skip&quot;
    }
  ],
  &quot;ctx&quot;: {
    &quot;form&quot;: {
      &quot;id&quot;: &quot;400&quot;
    },
    &quot;occupancies&quot;: [
      {
        &quot;id&quot;: &quot;a400&quot;
      },
      {
        &quot;id&quot;: &quot;b400&quot;
      }
    ]
  }
}</code>
</pre>
<!-- structured-process-demo:exception-demo-result:json:end -->

</div></div><div><div>

<!-- structured-process-demo:exception-demo:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["IC10: Get linked occupancy records
[ok]"]
  step_0 --> step_1
  step_1["IC25: Count the recovered occupancy trail and insist on exactly two records
[exception]
A contradictory record was discovered, so the sequence stops immediately."]
  step_1 --> step_2
  step_2["IC30: Cross-check the submitted form against the recovered occupancy trail
[skip]"]
  step_2 --> done
  done([Stopped by Exception])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
  class step_0 success
  class step_1 failure
  class step_2 neutral
  class start executed
  class done failure
```
<!-- structured-process-demo:exception-demo:mermaid:end -->

</div></div><div><p><strong>Overall outcome:</strong> <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;">stopped by exception</span><br><strong>Failed steps:</strong> IC25</p>
<!-- structured-process-demo:exception-demo:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th></tr></thead>
<tbody><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC10</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Get linked occupancy records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#166534;border:1px solid #86efac;">ok</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"></td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC25</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Count the recovered occupancy trail and insist on exactly two records</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;">exception</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">A contradictory record was discovered, so the sequence stops immediately.</td>
</tr><tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">IC30</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">Cross-check the submitted form against the recovered occupancy trail</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#f8fafc;color:#475569;border:1px solid #cbd5e1;">skip</span></td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;"></td>
</tr></tbody>
</table>
<!-- structured-process-demo:exception-demo:html-table:end --></div></div>
