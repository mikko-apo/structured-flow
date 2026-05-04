import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncFlow, BranchRunResult, createAsync, createSync, Flow, FlowResult, stepResult } from '../structuredFlow'
import { renderProcessAsMermaidGraph } from '../mermaid'

const demoSourceMarkerPrefix = 'structured-process-demo-example'
const branchOneSourceMarkerPrefix = 'branch-one-of-three-example'
const branchTwoSourceMarkerPrefix = 'branch-two-of-three-example'
const nestedBranchSourceMarkerPrefix = 'nested-branch-example'
const branchSkipSourceMarkerPrefix = 'branch-skip-example'

/* structured-process-demo-example:start */
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
/* structured-process-demo-example:end */

/* branch-one-of-three-example:start */
type PostingKind = 'income' | 'expense' | 'transfer'

const incomeFlow = createSync<{ amount: number; kind: PostingKind }>()
  .step('IN-1', 'Handle income', ({ amount }) => ({
    normalizedAmount: amount,
  }))
  .build()

const expenseFlow = createSync<{ amount: number; kind: PostingKind }>()
  .step('EX-1', 'Handle expense', ({ amount }) => ({
    normalizedAmount: -amount,
  }))
  .build()

const transferFlow = createSync<{ amount: number; kind: PostingKind }>()
  .step('TR-1', 'Handle transfer', () => ({
    transferSeen: true,
  }))
  .build()

const oneOfThreeBranchFlow = createSync<{ amount: number; kind: PostingKind }>()
  .branch('ROUTE', ({ kind }) => kind, {
    income: incomeFlow,
    expense: expenseFlow,
    transfer: transferFlow,
  })
  .build()
/* branch-one-of-three-example:end */

/* branch-two-of-three-example:start */
type CheckName = 'tax' | 'fraud' | 'policy'

const taxFlow = createAsync<{ amount: number; checks: CheckName[] }>()
  .step('TAX-1', 'Check taxes', async () => ({
    taxChecked: true,
  }))
  .build()

const fraudFlow = createAsync<{ amount: number; checks: CheckName[] }, string>()
  .step('FRAUD-1', 'Check fraud', async () =>
    stepResult({
      result: 'error',
      info: 'Fraud review failed.',
    })
  )
  .build()

const policyFlow = createAsync<{ amount: number; checks: CheckName[] }>()
  .step('POLICY-1', 'Check policy', async () => ({
    policyChecked: true,
  }))
  .build()

const twoOfThreeBranchFlow = createAsync<{ amount: number; checks: CheckName[] }>()
  .branch('CHECKS', ({ checks }) => checks, {
    tax: taxFlow,
    fraud: fraudFlow,
    policy: policyFlow,
  })
  .build()
/* branch-two-of-three-example:end */

/* nested-branch-example:start */
type FirstBranch = 'A' | 'B'
type SecondBranch = 'C' | 'D'

const branchAFlow = createSync<{ firstBranch: FirstBranch; secondBranch: SecondBranch }>()
  .step('A-1', 'Handle A', () => ({
    visitedA: true,
  }))
  .build()

const branchCFlow = createSync<{ firstBranch: FirstBranch; secondBranch: SecondBranch }>()
  .step('C-1', 'Handle C', () => ({
    visitedC: true,
  }))
  .build()

const branchDFlow = createSync<{ firstBranch: FirstBranch; secondBranch: SecondBranch }>()
  .step('D-1', 'Handle D', () => ({
    visitedD: true,
  }))
  .build()

const branchBFlow = createSync<{ firstBranch: FirstBranch; secondBranch: SecondBranch }>()
  .branch('B-ROUTE', ({ secondBranch }) => secondBranch, {
    C: branchCFlow,
    D: branchDFlow,
  })
  .build()

const nestedBranchFlow = createSync<{ firstBranch: FirstBranch; secondBranch: SecondBranch }>()
  .branch('ROOT-ROUTE', ({ firstBranch }) => firstBranch, {
    A: branchAFlow,
    B: branchBFlow,
  })
  .build()
/* nested-branch-example:end */

/* branch-skip-example:start */
const approveFlow = createSync<{ shouldRunChecks: boolean }>()
  .step('APP-1', 'Approve', () => ({
    approved: true,
  }))
  .build()

const rejectFlow = createSync<{ shouldRunChecks: boolean }>()
  .step('REJ-1', 'Reject', () => ({
    rejected: true,
  }))
  .build()

const reviewFlow = createSync<{ shouldRunChecks: boolean }>()
  .step('REV-1', 'Review', () => ({
    reviewed: true,
  }))
  .build()

const skippedBranchFlow = createSync<{ shouldRunChecks: boolean }>()
  .branch('OPTIONAL-CHECKS', ({ shouldRunChecks }) => (shouldRunChecks ? 'review' : 'skip'), {
    approve: approveFlow,
    reject: rejectFlow,
    review: reviewFlow,
  })
  .build()
/* branch-skip-example:end */

function escapeMarkdownCodeBlock(value: string): string {
  return value.replaceAll('```', '\\`\\`\\`')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

type GeneratedBlockKind = 'json' | 'mermaid' | 'html-table'
type MaybePromise<T> = T | Promise<T>
type FlowLike<InitialCtx extends object> = {
  steps: readonly { id: string; description: string }[]
  run(initial: InitialCtx): MaybePromise<FlowResult<any, any>>
}

function wrapGeneratedBlock(markerId: string, kind: GeneratedBlockKind, content: string): string {
  return [
    `<!-- structured-process-demo:${markerId}:${kind}:start -->`,
    content,
    `<!-- structured-process-demo:${markerId}:${kind}:end -->`,
  ].join('\n')
}

function renderHtmlTable(headers: string[], rows: string[][]): string {
  const headerHtml = headers
    .map(
      (header) => `<th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">${escapeHtml(header)}</th>`
    )
    .join('')
  const rowHtml = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(cell)}</td>`).join('')}</tr>`
    )
    .join('')

  return [
    '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
    `<thead><tr>${headerHtml}</tr></thead>`,
    `<tbody>${rowHtml}</tbody>`,
    '</table>',
  ].join('')
}

function renderMarkdownPane(content: string): string {
  return `<div>\n\n${content}\n\n</div>`
}

function renderThreeColumnHtml(firstHtml: string, secondHtml: string, thirdHtml: string): string {
  return [
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;">',
    `<div>${firstHtml}</div>`,
    `<div>${secondHtml}</div>`,
    `<div>${thirdHtml}</div>`,
    '</div>',
  ].join('')
}

function renderFlowTable(
  markerId: string,
  sequence: Pick<Flow<any, any, any>, 'steps'> | Pick<AsyncFlow<any, any, any>, 'steps'>
): string {
  return wrapGeneratedBlock(
    markerId,
    'html-table',
    renderHtmlTable(
      ['Step', 'Description'],
      sequence.steps.map((step: { id: string; description: string }) => [step.id, step.description])
    )
  )
}

function renderStatusBadge(result: string): string {
  const styles =
    result === 'ok'
      ? 'background:#ecfdf5;color:#166534;border:1px solid #86efac;'
      : result === 'skip'
        ? 'background:#f8fafc;color:#475569;border:1px solid #cbd5e1;'
        : result === 'stop'
          ? 'background:#f0fdf4;color:#166534;border:1px solid #86efac;'
          : 'background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;'

  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;${styles}">${escapeHtml(
    result
  )}</span>`
}

function renderOutcomeBadge(result: Pick<FlowResult<any, any>, 'ok' | 'stepResults'>): string {
  const finalResult = [...result.stepResults].reverse().find((stepResult) => stepResult.result !== 'skip')
  const label =
    finalResult == null
      ? 'done'
      : finalResult.result === 'stop'
        ? 'completed early'
        : finalResult.result === 'exception'
          ? 'stopped by exception'
          : result.ok
            ? 'successful sequence run'
            : 'completed with errors'

  const badgeType =
    finalResult?.result === 'exception' || (!result.ok && finalResult?.result !== 'stop')
      ? 'error'
      : finalResult?.result === 'stop'
        ? 'stop'
        : 'ok'

  return renderStatusBadge(badgeType).replace(`>${escapeHtml(badgeType)}<`, `>${escapeHtml(label)}<`)
}

function renderBranchStepDetails(stepResults: BranchRunResult['stepResults'], depth: number): string {
  if (stepResults.length === 0) {
    return '<div style="margin-top:4px;color:#64748b;">No branch steps recorded.</div>'
  }

  return stepResults
    .map(
      (stepResult) => `<div style="margin-top:4px;padding-left:${depth * 12}px;">
<div>${escapeHtml(stepResult.id)} ${renderStatusBadge(stepResult.result)}</div>
${stepResult.info == null ? '' : `<div style="margin-top:2px;color:#475569;">${escapeHtml(String(stepResult.info))}</div>`}
${renderBranchDetails(stepResult.branches, depth + 1)}
</div>`
    )
    .join('')
}

function renderBranchDetails(branches?: BranchRunResult[], depth = 0): string {
  if (branches == null || branches.length === 0) {
    return ''
  }

  return branches
    .map((branch) => {
      const descriptionById = new Map(branch.steps.map((step) => [step.id, step.description]))
      const stepResultsWithDescriptions = branch.stepResults.map((stepResult) => ({
        ...stepResult,
        id: descriptionById.get(stepResult.id) == null ? stepResult.id : `${stepResult.id}: ${descriptionById.get(stepResult.id) ?? ''}`,
      }))
      const stepHtml = renderBranchStepDetails(stepResultsWithDescriptions, depth + 1)

      return `<div style="margin-bottom:10px;padding-left:${depth * 12}px;">
<div><strong>${escapeHtml(branch.key)}</strong> ${renderStatusBadge(branch.result)}</div>
<div style="margin-top:2px;color:#475569;">Ctx: ${escapeHtml(JSON.stringify(branch.ctx))}</div>
${stepHtml}
</div>`
    })
    .join('')
}

function renderResultTable(
  markerId: string,
  steps: readonly { id: string; description: string }[],
  result: Pick<FlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults'>
): string {
  const failedStepIds = result.failedStepIds()
  const descriptionById = new Map(steps.map((step) => [step.id, step.description]))
  const rowsHtml = result.stepResults
    .map((stepResult) => {
      const description = descriptionById.get(stepResult.id) ?? ''

      return `<tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(stepResult.id)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(description)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStatusBadge(stepResult.result)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(
        stepResult.info == null ? '' : String(stepResult.info)
      )}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderBranchDetails(stepResult.branches)}</td>
</tr>`
    })
    .join('')

  return [
    `<p><strong>Overall outcome:</strong> ${renderOutcomeBadge(result)}<br><strong>Failed steps:</strong> ${escapeHtml(
      failedStepIds.length === 0 ? 'none' : failedStepIds.join(', ')
    )}</p>`,
    wrapGeneratedBlock(
      markerId,
      'html-table',
      [
        '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
        '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead>',
        `<tbody>${rowsHtml}</tbody>`,
        '</table>',
      ].join('\n')
    ),
  ].join('\n')
}

function renderJsonCodeBlock(markerId: string, value: unknown): string {
  return wrapGeneratedBlock(
    markerId,
    'json',
    [
      '<pre style="margin:0;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45;">',
      `<code>${escapeHtml(JSON.stringify(value, null, 2))}</code>`,
      '</pre>',
    ].join('\n')
  )
}

function renderMermaidBlock(markerId: string, graph: string): string {
  return wrapGeneratedBlock(markerId, 'mermaid', ['```mermaid', graph, '```'].join('\n'))
}

function renderDemoResultSection<Steps extends readonly any[]>(
  markerId: string,
  sequenceInit: unknown,
  result: Pick<FlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults' | 'ctx'> & { steps: Steps }
): string {
  return renderThreeColumnHtml(
    renderMarkdownPane(
      [
        '<p><strong>Init JSON</strong></p>',
        renderJsonCodeBlock(`${markerId}-init`, sequenceInit),
        '',
        '<p><strong>Result JSON</strong></p>',
        renderJsonCodeBlock(`${markerId}-result`, {
          ok: result.ok,
          failedStepIds: result.failedStepIds(),
          stepResults: result.stepResults,
          ctx: result.ctx,
        }),
      ].join('\n')
    ),
    renderMarkdownPane(renderMermaidBlock(markerId, renderProcessAsMermaidGraph(result))),
    renderResultTable(markerId, result.steps as readonly { id: string; description: string }[], result)
  )
}

function readStructuredProcessDemoCodeFromSource(): string {
  return readCodeBlockFromSource(demoSourceMarkerPrefix)
}

function sourceMarker(prefix: string, boundary: 'start' | 'end'): string {
  return `/* ${prefix}:${boundary} */`
}

function readCodeBlockFromSource(markerPrefix: string): string {
  const sourceFile = fileURLToPath(import.meta.url)
  const source = readFileSync(sourceFile, 'utf8')
  const startMarker = sourceMarker(markerPrefix, 'start')
  const endMarker = sourceMarker(markerPrefix, 'end')
  const startIndex = source.indexOf(startMarker)
  const endIndex = source.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Source markers "${startMarker}" and "${endMarker}" were not found in updateReadme.ts`)
  }

  return source.slice(startIndex + startMarker.length, endIndex).trim()
}

function replaceKeyToMarkerId(replaceKey: string): string {
  return replaceKey
    .replace(/_SECTION$/, '')
    .toLowerCase()
    .replaceAll('_', '-')
}

type GeneratedExample<InitialCtx extends object> = {
  codePlaceholder: string
  codeMarkerPrefix: string
  flow: FlowLike<InitialCtx>
  demoPlaceholder: string
  demoInit: InitialCtx
}

async function renderGeneratedExample<InitialCtx extends object>(
  markdown: string,
  { codePlaceholder, codeMarkerPrefix, flow, demoPlaceholder, demoInit }: GeneratedExample<InitialCtx>
): Promise<string> {
  const exampleCode = readCodeBlockFromSource(codeMarkerPrefix)
  const result = await flow.run(demoInit)

  return markdown
    .replace(`{{${codePlaceholder}}}`, ['```ts', escapeMarkdownCodeBlock(exampleCode), '```'].join('\n'))
    .replace(
      `{{${demoPlaceholder}}}`,
      renderDemoResultSection(replaceKeyToMarkerId(demoPlaceholder), demoInit, result)
    )
}

async function renderStructuredProcessExampleMarkdown<InitialCtx extends object>(
  sequence: FlowLike<InitialCtx>,
  demoFlowInits: Record<string, InitialCtx>
): Promise<string> {
  const templateFile = join(dirname(fileURLToPath(import.meta.url)), 'structuredFlowDemo.readme.template.md')
  const template = readFileSync(templateFile, 'utf8')
  const exampleCode = readStructuredProcessDemoCodeFromSource()

  let markdown = template
    .replace('{{SEQUENCE_CODE_BLOCK}}', ['```ts', escapeMarkdownCodeBlock(exampleCode), '```'].join('\n'))
    .replace(
      '{{STATIC_GRAPH_SECTION}}',
      renderThreeColumnHtml(
        '<p><strong>Result JSON</strong><br>Static sequence view does not have a run result yet.</p>',
        renderMarkdownPane(renderMermaidBlock('static-graph', renderProcessAsMermaidGraph(sequence))),
        renderFlowTable('static-graph', sequence)
      )
    )

  for (const [replaceKey, sequenceInit] of Object.entries(demoFlowInits)) {
    const result = await sequence.run(sequenceInit)
    markdown = markdown.replace(
      `{{${replaceKey}}}`,
      renderDemoResultSection(replaceKeyToMarkerId(replaceKey), sequenceInit, result)
    )
  }

  markdown = await renderGeneratedExample(markdown, {
    codePlaceholder: 'BRANCH_ONE_OF_THREE_CODE_BLOCK',
    codeMarkerPrefix: branchOneSourceMarkerPrefix,
    flow: oneOfThreeBranchFlow,
    demoPlaceholder: 'BRANCH_ONE_OF_THREE_DEMO_SECTION',
    demoInit: { amount: 24, kind: 'expense' },
  })

  markdown = await renderGeneratedExample(markdown, {
    codePlaceholder: 'BRANCH_TWO_OF_THREE_CODE_BLOCK',
    codeMarkerPrefix: branchTwoSourceMarkerPrefix,
    flow: twoOfThreeBranchFlow,
    demoPlaceholder: 'BRANCH_TWO_OF_THREE_DEMO_SECTION',
    demoInit: { amount: 8, checks: ['tax', 'fraud'] },
  })

  markdown = await renderGeneratedExample(markdown, {
    codePlaceholder: 'NESTED_BRANCH_CODE_BLOCK',
    codeMarkerPrefix: nestedBranchSourceMarkerPrefix,
    flow: nestedBranchFlow,
    demoPlaceholder: 'NESTED_BRANCH_DEMO_SECTION',
    demoInit: { firstBranch: 'B', secondBranch: 'D' },
  })

  markdown = await renderGeneratedExample(markdown, {
    codePlaceholder: 'BRANCH_SKIP_CODE_BLOCK',
    codeMarkerPrefix: branchSkipSourceMarkerPrefix,
    flow: skippedBranchFlow,
    demoPlaceholder: 'BRANCH_SKIP_DEMO_SECTION',
    demoInit: { shouldRunChecks: false },
  })

  return markdown
}

export async function writeStructuredProcessExampleMarkdown(
  outputFile = join(dirname(fileURLToPath(import.meta.url)), '../..', 'README.md')
) {
  writeFileSync(
    outputFile,
    await renderStructuredProcessExampleMarkdown(sequence, {
      PASSING_DEMO_SECTION: { form: { id: '200' } },
      FAILING_DEMO_SECTION: { form: { id: '123' } },
      STOP_DEMO_SECTION: { form: { id: '300' } },
      EXCEPTION_DEMO_SECTION: { form: { id: '400' } },
    })
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeStructuredProcessExampleMarkdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
