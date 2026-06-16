import { readFileSync, writeFileSync } from 'node:fs'

import type { EnrichedBranchRunResult, EnrichedFlowResult, FlowResult, FlowStepDefinition } from '../structuredFlow.ts'
import { renderProcessAsMermaidGraph } from '../mermaidRenderer.ts'

type GeneratedBlockKind = 'json' | 'mermaid' | 'html-table'
type MaybePromise<T> = T | Promise<T>

type FlowLike<InitialCtx extends object> = {
  steps: readonly { id: string; description: unknown }[]
  run(initial: InitialCtx): MaybePromise<FlowResult<any, any>>
}

type DocumentationDemo<InitialCtx extends object> = {
  id: string
  init: InitialCtx
}

type DocumentationExample<InitialCtx extends object> = {
  id: string
  sourceFile?: string
  flow: FlowLike<InitialCtx>
  demos?: readonly DocumentationDemo<InitialCtx>[]
}

type RenderMarkdownDocumentationOptions = {
  template: string
  sourceFile: string
  generatedExamples?: readonly DocumentationExample<any>[]
}

type WriteMarkdownDocumentationOptions = Omit<
  RenderMarkdownDocumentationOptions,
  'template' | 'sourceFile'
> & {
  templateFile: string
  documentationSourceFile: string
  outputFile: string
  logMarkers?: boolean
}

function escapeMarkdownCodeBlock(value: string): string {
  return value.replaceAll('```', '\\`\\`\\`')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function formatDescription(description: unknown): string {
  if (typeof description === 'string') {
    return description
  }

  const json = JSON.stringify(description)
  return json ?? String(description)
}

function truncate(value: string, maxLength = 160): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}

function describeFunction(fn: { toString(): string }) {
  const source = fn.toString().trim()
  const normalized = source.replace(/\s+/g, ' ')
  const isAsync = normalized.startsWith('async ')

  if (normalized.includes('=>')) {
    const [rawParams, rawBody = ''] = normalized.split(/=>\s*/, 2)

    return {
      kind: 'arrow-function',
      async: isAsync,
      params: rawParams.replace(/^async\s*/, '').trim(),
      bodyPreview: truncate(rawBody.trim()),
    }
  }

  const functionMatch = normalized.match(/^(async\s+)?function(?:\s+([^(]+))?\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/)

  if (functionMatch != null) {
    return {
      kind: 'function',
      async: isAsync,
      name: functionMatch[2]?.trim() || 'anonymous',
      params: functionMatch[3].trim(),
      bodyPreview: truncate(functionMatch[4].trim()),
    }
  }

  return {
    kind: 'function',
    async: isAsync,
    sourcePreview: truncate(normalized),
  }
}

function serializeForJson(value: unknown): unknown {
  if (typeof value === 'function') {
    return describeFunction(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeForJson(item))
  }

  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeForJson(entry)]))
  }

  return value
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

function renderFlowTable(markerId: string, sequence: { steps: readonly FlowStepDefinition<unknown>[] }): string {
  return wrapGeneratedBlock(
    markerId,
    'html-table',
    renderHtmlTable(
      ['Step', 'Description'],
      sequence.steps.map((step: { id: string; description: unknown }) => [step.id, formatDescription(step.description)])
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

function renderBranchStepDetails(stepResults: EnrichedBranchRunResult['stepResults'], depth: number): string {
  if (stepResults.length === 0) {
    return '<div style="margin-top:4px;color:#64748b;">No branch steps recorded.</div>'
  }

  return stepResults
    .map(
      (stepResult) => `<div style="margin-top:4px;padding-left:${depth * 12}px;">
<div>${escapeHtml(`${stepResult.id}: ${formatDescription(stepResult.description)}`)} ${renderStatusBadge(stepResult.result)}</div>
${stepResult.info == null ? '' : `<div style="margin-top:2px;color:#475569;">${escapeHtml(String(stepResult.info))}</div>`}
${stepResult.addToCtx == null ? '' : `<div style="margin-top:2px;color:#475569;">Add to ctx: ${escapeHtml(JSON.stringify(stepResult.addToCtx))}</div>`}
${renderBranchDetails(stepResult.branches, depth + 1)}
</div>`
    )
    .join('')
}

function renderBranchDetails(branches?: EnrichedBranchRunResult[], depth = 0): string {
  if (branches == null || branches.length === 0) {
    return ''
  }

  return branches
    .map((branch) => {
      const stepHtml = renderBranchStepDetails(branch.stepResults, depth + 1)

      return `<div style="margin-bottom:10px;padding-left:${depth * 12}px;">
<div><strong>${escapeHtml(branch.key)}</strong> ${renderStatusBadge(branch.result)}</div>
<div style="margin-top:2px;color:#475569;">Final ctx: ${escapeHtml(JSON.stringify(branch.finalCtx))}</div>
${stepHtml}
</div>`
    })
    .join('')
}

function renderResultTable(
  markerId: string,
  result: Pick<EnrichedFlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults'>
): string {
  const failedStepIds = result.failedStepIds()
  const rowsHtml = result.stepResults
    .map(
      (stepResult) => `<tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(stepResult.id)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(formatDescription(stepResult.description))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStatusBadge(stepResult.result)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(
        stepResult.info == null ? '' : String(stepResult.info)
      )}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(
        stepResult.addToCtx == null ? '' : JSON.stringify(stepResult.addToCtx)
      )}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderBranchDetails(stepResult.branches)}</td>
</tr>`
    )
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
        '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Info</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Add to ctx</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead>',
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

function renderFlowConfigurationJson(markerId: string, flow: unknown): string {
  return renderJsonCodeBlock(markerId, serializeForJson(flow))
}

function renderMermaidBlock(markerId: string, graph: string): string {
  return wrapGeneratedBlock(markerId, 'mermaid', ['```mermaid', graph, '```'].join('\n'))
}

function renderDemoResultSection<Steps extends readonly any[]>(
  markerId: string,
  sequenceInit: unknown,
  result: Pick<FlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults' | 'finalCtx'> & { steps: Steps },
  enrichedResult: Pick<EnrichedFlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults'>
): string {
  const parts = renderDemoResultParts(markerId, sequenceInit, result, enrichedResult)

  return renderThreeColumnHtml(
    renderMarkdownPane([parts.initJson, '', parts.resultJson].join('\n')),
    renderMarkdownPane(parts.resultMermaid),
    parts.resultHtml
  )
}

function renderDemoResultParts<Steps extends readonly any[]>(
  markerId: string,
  sequenceInit: unknown,
  result: Pick<FlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults' | 'finalCtx'> & { steps: Steps },
  enrichedResult: Pick<EnrichedFlowResult<any, any>, 'ok' | 'failedStepIds' | 'stepResults'>
) {
  return {
    initJson: ['<p><strong>Initial JSON parameter</strong></p>', renderJsonCodeBlock(`${markerId}-init`, sequenceInit)].join(
      '\n'
    ),
    resultJson: [
      '<p><strong>Resulting JSON</strong></p>',
      renderJsonCodeBlock(`${markerId}-result`, {
        ok: result.ok,
        failedStepIds: result.failedStepIds(),
        stepResults: result.stepResults,
        finalCtx: result.finalCtx,
      }),
    ].join('\n'),
    resultMermaid: renderMermaidBlock(markerId, renderProcessAsMermaidGraph(result)),
    resultHtml: renderResultTable(markerId, enrichedResult),
  }
}

function sourceMarker(id: string, boundary: 'START' | 'END'): string {
  return `/* ${id}:${boundary} */`
}

function readCodeBlockFromSource(sourceFile: string, id: string): string {
  const source = readFileSync(sourceFile, 'utf8')
  const startMarker = sourceMarker(id, 'START')
  const endMarker = sourceMarker(id, 'END')
  const startIndex = source.indexOf(startMarker)
  const endIndex = source.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Source markers "${startMarker}" and "${endMarker}" were not found in ${sourceFile}`)
  }

  return source.slice(startIndex + startMarker.length, endIndex).trim()
}

function replaceKeyToMarkerId(replaceKey: string): string {
  return replaceKey
    .replace(/_SECTION$/, '')
    .toLowerCase()
    .replaceAll('_', '-')
}

function codePlaceholder(id: string): string {
  return `${id}_CODE_BLOCK`
}

function flowJsonPlaceholder(id: string): string {
  return `${id}_FLOW_JSON`
}

function staticGraphPlaceholder(id: string): string {
  return `${id}_STATIC_GRAPH`
}

function demoBase(exampleId: string, demoId: string): string {
  return `${exampleId}_${demoId}`
}

function demoFullTablePlaceholder(exampleId: string, demoId: string): string {
  return `${demoBase(exampleId, demoId)}_FULL_TABLE`
}

function demoInitJsonPlaceholder(exampleId: string, demoId: string): string {
  return `${demoBase(exampleId, demoId)}_INIT_JSON`
}

function demoResultJsonPlaceholder(exampleId: string, demoId: string): string {
  return `${demoBase(exampleId, demoId)}_RESULT_JSON`
}

function demoResultMermaidPlaceholder(exampleId: string, demoId: string): string {
  return `${demoBase(exampleId, demoId)}_RESULT_MERMAID`
}

function demoResultHtmlPlaceholder(exampleId: string, demoId: string): string {
  return `${demoBase(exampleId, demoId)}_RESULT_HTML`
}

function demoMarkerId(exampleId: string, demoId: string): string {
  return replaceKeyToMarkerId(demoBase(exampleId, demoId))
}

function templatePlaceholderToken(id: string): string {
  return `{{${id}}}`
}

function templateIncludes(template: string, placeholderId: string): boolean {
  return template.includes(templatePlaceholderToken(placeholderId))
}

type MarkerReportEntry = {
  marker: string
  used: boolean
}

function formatUsage(marker: string, used: boolean): string {
  return used ? marker : `${marker} (unused)`
}

function logMarkerReport(
  template: string,
  templateFile: string,
  defaultSourceFile: string,
  generatedExamples: readonly DocumentationExample<any>[]
) {
  for (const example of generatedExamples) {
    const exampleSourceFile = example.sourceFile ?? defaultSourceFile
    const flowMarkers: MarkerReportEntry[] = [
      {
        marker: templatePlaceholderToken(codePlaceholder(example.id)),
        used: templateIncludes(template, codePlaceholder(example.id)),
      },
      {
        marker: templatePlaceholderToken(staticGraphPlaceholder(example.id)),
        used: templateIncludes(template, staticGraphPlaceholder(example.id)),
      },
      {
        marker: templatePlaceholderToken(flowJsonPlaceholder(example.id)),
        used: templateIncludes(template, flowJsonPlaceholder(example.id)),
      },
    ]

    console.log(`${example.id}:`)
    console.log(`- source code in ${exampleSourceFile}: ${sourceMarker(example.id, 'START')} / ${sourceMarker(example.id, 'END')}`)
    console.log(`- output in ${templateFile}:`)
    console.log('  - flow markers:')
    for (const entry of flowMarkers) {
      console.log(`    - ${formatUsage(entry.marker, entry.used)}`)
    }
    console.log('  - demos:')
    for (const demo of example.demos ?? []) {
      const demoName = demoBase(example.id, demo.id)
      const demoMarkers: MarkerReportEntry[] = [
        {
          marker: templatePlaceholderToken(demoFullTablePlaceholder(example.id, demo.id)),
          used: templateIncludes(template, demoFullTablePlaceholder(example.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoInitJsonPlaceholder(example.id, demo.id)),
          used: templateIncludes(template, demoInitJsonPlaceholder(example.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoResultJsonPlaceholder(example.id, demo.id)),
          used: templateIncludes(template, demoResultJsonPlaceholder(example.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoResultMermaidPlaceholder(example.id, demo.id)),
          used: templateIncludes(template, demoResultMermaidPlaceholder(example.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoResultHtmlPlaceholder(example.id, demo.id)),
          used: templateIncludes(template, demoResultHtmlPlaceholder(example.id, demo.id)),
        },
      ]

      console.log(`    - ${demoName}`)
      for (const entry of demoMarkers) {
        console.log(`      - ${formatUsage(entry.marker, entry.used)}`)
      }
    }
  }
}

async function renderGeneratedExample(
  markdown: string,
  sourceFile: string,
  example: DocumentationExample<any>
): Promise<string> {
  let nextMarkdown = markdown
  const exampleCode = readCodeBlockFromSource(example.sourceFile ?? sourceFile, example.id)

  if (templateIncludes(markdown, codePlaceholder(example.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(codePlaceholder(example.id)),
      ['```ts', escapeMarkdownCodeBlock(exampleCode), '```'].join('\n')
    )
  }

  if (templateIncludes(markdown, flowJsonPlaceholder(example.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(flowJsonPlaceholder(example.id)),
      renderFlowConfigurationJson(replaceKeyToMarkerId(flowJsonPlaceholder(example.id)), example.flow)
    )
  }

  if (templateIncludes(markdown, staticGraphPlaceholder(example.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(staticGraphPlaceholder(example.id)),
      renderThreeColumnHtml(
        '<p><strong>Result JSON</strong><br>No run result yet.</p>',
        renderMarkdownPane(
          renderMermaidBlock(replaceKeyToMarkerId(staticGraphPlaceholder(example.id)), renderProcessAsMermaidGraph(example.flow))
        ),
        renderFlowTable(replaceKeyToMarkerId(staticGraphPlaceholder(example.id)), example.flow)
      )
    )
  }

  for (const demo of example.demos ?? []) {
    const result = await example.flow.run(demo.init)
    const enrichedResult = result.enrichResult()
    const markerId = demoMarkerId(example.id, demo.id)
    const parts = renderDemoResultParts(markerId, demo.init, result, enrichedResult)

    if (templateIncludes(nextMarkdown, demoFullTablePlaceholder(example.id, demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoFullTablePlaceholder(example.id, demo.id)),
        renderDemoResultSection(markerId, demo.init, result, enrichedResult)
      )
    }

    if (templateIncludes(nextMarkdown, demoInitJsonPlaceholder(example.id, demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoInitJsonPlaceholder(example.id, demo.id)),
        parts.initJson
      )
    }

    if (templateIncludes(nextMarkdown, demoResultJsonPlaceholder(example.id, demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoResultJsonPlaceholder(example.id, demo.id)),
        parts.resultJson
      )
    }

    if (templateIncludes(nextMarkdown, demoResultMermaidPlaceholder(example.id, demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoResultMermaidPlaceholder(example.id, demo.id)),
        parts.resultMermaid
      )
    }

    if (templateIncludes(nextMarkdown, demoResultHtmlPlaceholder(example.id, demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoResultHtmlPlaceholder(example.id, demo.id)),
        parts.resultHtml
      )
    }
  }

  return nextMarkdown
}

async function renderMarkdownDocumentation({
  template,
  sourceFile,
  generatedExamples = [],
}: RenderMarkdownDocumentationOptions): Promise<string> {
  let markdown = template

  for (const example of generatedExamples) {
    markdown = await renderGeneratedExample(markdown, sourceFile, example)
  }

  return markdown
}

export async function writeMarkdownDocumentation({
  templateFile,
  documentationSourceFile,
  outputFile,
  logMarkers = false,
  ...renderOptions
}: WriteMarkdownDocumentationOptions): Promise<void> {
  const template = readFileSync(templateFile, 'utf8')

  if (logMarkers) {
    logMarkerReport(template, templateFile, documentationSourceFile, renderOptions.generatedExamples ?? [])
  }

  writeFileSync(
    outputFile,
    await renderMarkdownDocumentation({
      template,
      sourceFile: documentationSourceFile,
      ...renderOptions,
    })
  )
}
