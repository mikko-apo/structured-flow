import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncFlow, createAsync, Flow, FlowResult, stepResult } from '../structuredFlow'
import { renderProcessAsMermaidGraph } from '../mermaid'

const demoSourceMarkerPrefix = 'structured-process-demo-example'
const demoSourceStartMarker = `/* ${demoSourceMarkerPrefix}:start */`
const demoSourceEndMarker = `/* ${demoSourceMarkerPrefix}:end */`

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
        '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th></tr></thead>',
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
  const sourceFile = fileURLToPath(import.meta.url)
  const source = readFileSync(sourceFile, 'utf8')
  const startIndex = source.indexOf(demoSourceStartMarker)
  const endIndex = source.indexOf(demoSourceEndMarker)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Structured flow demo source markers were not found in structuredFlowDemo.ts')
  }

  return source.slice(startIndex + demoSourceStartMarker.length, endIndex).trim()
}

function replaceKeyToMarkerId(replaceKey: string): string {
  return replaceKey
    .replace(/_SECTION$/, '')
    .toLowerCase()
    .replaceAll('_', '-')
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

  return markdown
}

async function writeStructuredProcessExampleMarkdown(
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
