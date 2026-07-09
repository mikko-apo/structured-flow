<a id="core-api"></a>
# Core API

const validations = createAsyncFlow('IC10', async ({ form }) => ({ occupancyCount: form.occupantCount }), { description: 'Get linked occupancy records' })

const result = await validations.run({form: {id: '200', occupantCount: 2, requiresManualReview: false}})

<a id="resolver-flow"></a>
# Resolver Flow

createSyncFlow({ resolver }).step(stepInfo) resolves id, description, and an optional default step function from the step info object.

<a id="core-api-flow"></a>
## Core API

Basic async validation flow with a fixed input ctx.

<!-- structured-process-demo:core-api-flow-html:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead><tbody><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>IC10</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">IC10</div><div style="margin-top:4px;color:#334155;font-size:13px;">Get linked occupancy records</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>IC20</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">IC20</div><div style="margin-top:4px;color:#334155;font-size:13px;">Verify occupancy count</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr></tbody></table>
<!-- structured-process-demo:core-api-flow-html:html-table:end -->

<!-- structured-process-demo:core-api-static-graph:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["IC10: Get linked occupancy records"]
  step_0 --> step_1
  step_1["IC20: Verify occupancy count"]
  step_1 --> done
  done([Done])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
  classDef join fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,color:#475569
```
<!-- structured-process-demo:core-api-static-graph:mermaid:end -->

<a id="resolver-flow-flow"></a>
## Resolver-based flow

Flow created with resolver so step ids carry their own description and optional step fn.

<!-- structured-process-demo:resolver-flow-flow-html:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead><tbody><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>VALIDATE-1</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">VALIDATE-1</div><div style="margin-top:4px;color:#334155;font-size:13px;">Validate request</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>REVIEW-1</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">REVIEW-1</div><div style="margin-top:4px;color:#334155;font-size:13px;">Route review</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;"><div style="border:1px solid #d0d7de;border-radius:6px;padding:10px;background:#f8fafc;">
<div><strong>auto</strong></div>
<div style="margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead><tbody><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>AUTO-1</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">AUTO-1</div><div style="margin-top:4px;color:#334155;font-size:13px;">Auto approve</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr></tbody></table></div>
</div><div style="border:1px solid #d0d7de;border-radius:6px;padding:10px;background:#f8fafc;">
<div><strong>manual</strong></div>
<div style="margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead><tbody><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>MANUAL-1</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">MANUAL-1</div><div style="margin-top:4px;color:#334155;font-size:13px;">Send to manual review</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr></tbody></table></div>
</div></div></td>
</tr></tbody></table>
<!-- structured-process-demo:resolver-flow-flow-html:html-table:end -->

<!-- structured-process-demo:resolver-flow-static-graph:mermaid:start -->
```mermaid
flowchart TD
  start([Start])
  step_0["VALIDATE-1: Validate request"]
  step_0 --> step_1
  step_1["REVIEW-1: Route review
branches: auto, manual"]
  branch_1_end["REVIEW-1:
end"]
  branch_1_end --> done
  class branch_1_end join
  branch_1_0_start["Branch: auto"]
  step_1 --> branch_1_0_start
  branch_1_0_step_0["AUTO-1: Auto approve"]
  branch_1_0_start --> branch_1_0_step_0
  branch_1_0_step_0 --> branch_1_end
  class branch_1_0_start executed
  branch_1_1_start["Branch: manual"]
  step_1 --> branch_1_1_start
  branch_1_1_step_0["MANUAL-1: Send to manual review"]
  branch_1_1_start --> branch_1_1_step_0
  branch_1_1_step_0 --> branch_1_end
  class branch_1_1_start executed
  done([Done])
  start --> step_0
  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px
  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px
  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px
  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2
  classDef join fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,color:#475569
```
<!-- structured-process-demo:resolver-flow-static-graph:mermaid:end -->

## Referenced leaf flows

<a id="auto-1-flow"></a>
### AUTO-1

Auto approve

**Referenced from**

- Resolver-based flow
<!-- structured-process-demo:auto-1-flow-html:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead><tbody><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>AUTO-1</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">AUTO-1</div><div style="margin-top:4px;color:#334155;font-size:13px;">Auto approve</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr></tbody></table>
<!-- structured-process-demo:auto-1-flow-html:html-table:end -->

<a id="manual-1-flow"></a>
### MANUAL-1

Send to manual review

**Referenced from**

- Resolver-based flow
<!-- structured-process-demo:manual-1-flow-html:html-table:start -->
<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead><tbody><tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;"><div><strong>MANUAL-1</strong></div><div style="margin-top:2px;color:#475569;font-size:12px;">MANUAL-1</div><div style="margin-top:4px;color:#334155;font-size:13px;">Send to manual review</div></td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;"><div style="color:#94a3b8;">-</div></td>
</tr></tbody></table>
<!-- structured-process-demo:manual-1-flow-html:html-table:end -->
