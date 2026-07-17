import { readFileSync, writeFileSync } from 'node:fs'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import { getOwnEntries } from '../utils.ts'
import { renderProcessAsMermaidGraph } from '../mermaidRenderer.ts'
import { type FlowResult, type FlowStepInfo, StepBranchInfo } from '../flowClasses.ts'

type GeneratedBlockKind = 'json' | 'mermaid' | 'html-table'
type ConvertedStepResult = {
  id: string
  description?: string
  status: 'ok' | 'skip' | 'stop' | 'error' | 'exception'
  originalStatus?: 'ok' | 'skip' | 'stop' | 'error' | 'exception'
  result?: Record<string, unknown>
  selectedBranchKeys?: PropertyKey[]
  branches?: ConvertedBranchStepFlowResult[]
}

type ConvertedBranchStepFlowResult = {
  key: PropertyKey
  status: ConvertedStepResult['status']
  stepResults: ConvertedStepResult[]
}

type ConvertedFlowResult = {
  status: ConvertedStepResult['status']
  stepResults: ConvertedStepResult[]
}

type FlowLike = {
  steps: readonly FlowStepInfo[]
  asyncMode: 'sync' | 'async'
  allowsContext: boolean
  run(...args: [data: object] | [data: object, ctx: unknown]): Promise<FlowResult<any>> | FlowResult<any>
}

type DocumentationDemo<InitialCtx extends object> = {
  id: string
  init: InitialCtx
  ctx?: unknown
  title?: string
  description?: string
}

type DocumentationFlow<InitialCtx extends object> = {
  id: string
  sourceFile?: string
  flow: FlowLike
  title?: string
  description?: string
  demos?: readonly DocumentationDemo<InitialCtx>[]
}

type AnyDocumentationFlow = DocumentationFlow<any>

type FormattedItem = {
  id: string
  title: string
  description?: string
}

type FormattedStepItem = {
  title: string
  description?: string
}

type StepNodeOf<TFlow extends AnyDocumentationFlow> = TFlow['flow']['steps'][number]
type StepNodeFromFlows<TFlows extends readonly AnyDocumentationFlow[]> = StepNodeOf<TFlows[number]>
type FlowMarkerOf<TFlow extends AnyDocumentationFlow> =
  | `${TFlow['id']}_CODE_BLOCK`
  | `${TFlow['id']}_FLOW_JSON`
  | `${TFlow['id']}_STATIC_GRAPH`
  | `${TFlow['id']}_FLOW_HTML`
type DemoIdOf<TFlow extends AnyDocumentationFlow> = NonNullable<TFlow['demos']>[number]['id']
type DemoMarkerOf<TFlow extends AnyDocumentationFlow> =
  | `${TFlow['id']}_${DemoIdOf<TFlow>}_FULL_TABLE`
  | `${TFlow['id']}_${DemoIdOf<TFlow>}_INIT_JSON`
  | `${TFlow['id']}_${DemoIdOf<TFlow>}_RESULT_JSON`
  | `${TFlow['id']}_${DemoIdOf<TFlow>}_RESULT_MERMAID`
  | `${TFlow['id']}_${DemoIdOf<TFlow>}_RESULT_HTML`
type GlobalSectionMarker = 'TOC' | 'ALL_FLOWS_HTML_MERMAID' | 'LEAF_FLOWS_HTML'
type SectionMarker<TFlows extends readonly AnyDocumentationFlow[]> =
  | GlobalSectionMarker
  | FlowMarkerOf<TFlows[number]>
  | DemoMarkerOf<TFlows[number]>

type HeadingSection = {
  kind: 'heading'
  level: number
  text: string
}

type ParagraphSection = {
  kind: 'p'
  text: string
}

type DocumentationSection<TFlows extends readonly AnyDocumentationFlow[]> =
  | SectionMarker<TFlows>
  | HeadingSection
  | ParagraphSection

type DocumentationFormatter<TNode extends FlowStepInfo = FlowStepInfo> = (
  node: TNode,
  flowId: string
) => FormattedStepItem

type RenderMarkdownDocumentationOptions<
  TFlows extends readonly AnyDocumentationFlow[] = readonly AnyDocumentationFlow[],
> = {
  template: string
  sourceFile: string
  formatter?: DocumentationFormatter<StepNodeFromFlows<TFlows>>
  flows?: TFlows
  pageContent?: readonly DocumentationSection<TFlows>[]
}

type WriteMarkdownDocumentationTemplateOptions<
  TFlows extends readonly AnyDocumentationFlow[] = readonly AnyDocumentationFlow[],
> = Omit<RenderMarkdownDocumentationOptions<TFlows>, 'template' | 'sourceFile'> & {
  templateFile: string
  pageContent?: never
  documentationSourceFile: string
  outputFile: string
  printReport?: boolean
}

type WriteMarkdownDocumentationPageContentOptions<
  TFlows extends readonly AnyDocumentationFlow[] = readonly AnyDocumentationFlow[],
> = Omit<RenderMarkdownDocumentationOptions<TFlows>, 'template' | 'sourceFile'> & {
  templateFile?: never
  pageContent: readonly DocumentationSection<TFlows>[]
  documentationSourceFile: string
  outputFile: string
  printReport?: boolean
}

type WriteMarkdownDocumentationOptions<
  TFlows extends readonly AnyDocumentationFlow[] = readonly AnyDocumentationFlow[],
> = WriteMarkdownDocumentationTemplateOptions<TFlows> | WriteMarkdownDocumentationPageContentOptions<TFlows>

type DemoRender<InitialCtx extends object> = {
  demo: DocumentationDemo<InitialCtx>
  result: FlowResult<any>
  convertedResult: ConvertedFlowResult
  failedStepIds: string[]
}

function escapeMarkdownCodeBlock(value: string): string {
  return value.replaceAll('```', '\\`\\`\\`')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function humanizeId(value: string): string {
  return value
    .toLowerCase()
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

function getStepDescription(step: Pick<FlowStepInfo, 'options'>): string | undefined {
  return typeof step.options?.description === 'string' ? step.options.description : undefined
}

function defaultFormatter(node: FlowStepInfo, flowId: string): FormattedStepItem {
  void flowId
  return {
    title: node.id,
    description: getStepDescription(node),
  }
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

function wrapWithAnchor(anchorId: string, content: string): string {
  return [`<a id="${escapeHtml(anchorId)}"></a>`, content].join('\n')
}

function renderPageContent<TFlows extends readonly AnyDocumentationFlow[]>(
  pageContent: readonly DocumentationSection<TFlows>[]
): string {
  return pageContent
    .map((item) => {
      if (typeof item === 'string') {
        return templatePlaceholderToken(item)
      }

      if (item.kind === 'heading') {
        return wrapWithAnchor(anchorForHeading(item.text), `${'#'.repeat(item.level)} ${item.text}`)
      }

      return item.text
    })
    .join('\n\n')
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

function renderOutcomeBadge(result: { status: string; stepResults: Array<{ status: string }> }): string {
  const finalResult = [...result.stepResults].reverse().find((stepResult) => stepResult.status !== 'skip')
  const label =
    finalResult == null
      ? 'done'
      : finalResult.status === 'stop'
        ? 'completed early'
        : finalResult.status === 'exception'
          ? 'stopped by exception'
          : result.status === 'error'
            ? 'completed with errors'
            : result.status === 'ok'
              ? 'successful sequence run'
              : 'done'

  const badgeType =
    result.status === 'exception' || result.status === 'error'
      ? 'error'
      : result.status === 'stop'
        ? 'stop'
        : result.status === 'skip'
          ? 'skip'
          : 'ok'

  return renderStatusBadge(badgeType).replace(`>${escapeHtml(badgeType)}<`, `>${escapeHtml(label)}<`)
}

function renderStepPayload(stepResult: Pick<ConvertedStepResult, 'result'>): string {
  return stepResult.result == null || Object.keys(stepResult.result).length === 0
    ? ''
    : JSON.stringify(stepResult.result)
}

function renderBranchStepDetails(stepResults: ConvertedBranchStepFlowResult['stepResults'], depth: number): string {
  if (stepResults.length === 0) {
    return '<div style="margin-top:4px;color:#64748b;">No branch steps recorded.</div>'
  }

  return stepResults
    .map(
      (stepResult) => `<div style="margin-top:4px;padding-left:${depth * 12}px;">
<div>${escapeHtml(`${String(stepResult.id)}: ${formatDescription(stepResult.description)}`)} ${renderStatusBadge(String(stepResult.status))}</div>
${renderStepPayload(stepResult) === '' ? '' : `<div style="margin-top:2px;color:#475569;">${escapeHtml(renderStepPayload(stepResult))}</div>`}
${renderBranchDetails(stepResult.branches, depth + 1)}
</div>`
    )
    .join('')
}

function renderBranchDetails(branches?: ConvertedBranchStepFlowResult[], depth = 0): string {
  if (branches == null || branches.length === 0) {
    return ''
  }

  return branches
    .map((branch) => {
      const stepHtml = renderBranchStepDetails(branch.stepResults, depth + 1)

      return `<div style="margin-bottom:10px;padding-left:${depth * 12}px;">
<div><strong>${escapeHtml(String(branch.key))}</strong> ${renderStatusBadge(String(branch.status))}</div>
${stepHtml}
</div>`
    })
    .join('')
}

function renderResultTable(
  markerId: string,
  result: Pick<ConvertedFlowResult, 'status' | 'stepResults'>,
  failedStepIds: string[]
): string {
  const rowsHtml = result.stepResults
    .map(
      (stepResult) => `<tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(String(stepResult.id))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(formatDescription(stepResult.description))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStatusBadge(String(stepResult.status))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(renderStepPayload(stepResult))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderBranchDetails(stepResult.branches)}</td>
</tr>`
    )
    .join('')

  return [
    `<p><strong>Overall outcome:</strong> ${renderOutcomeBadge(result as unknown as { status: string; stepResults: Array<{ status: string }> })}<br><strong>Failed steps:</strong> ${escapeHtml(
      failedStepIds.length === 0 ? 'none' : failedStepIds.join(', ')
    )}</p>`,
    wrapGeneratedBlock(
      markerId,
      'html-table',
      [
        '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
        '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Status</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Payload</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead>',
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
    .replace(/_FULL_TABLE$/, '')
    .replace(/_SECTION$/, '')
    .replace(/_INIT_JSON$/, '')
    .replace(/_RESULT_JSON$/, '')
    .replace(/_RESULT_MERMAID$/, '')
    .replace(/_RESULT_HTML$/, '')
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

function flowHtmlPlaceholder(id: string): string {
  return `${id}_FLOW_HTML`
}

function tocPlaceholder(): string {
  return 'TOC'
}

function allFlowsHtmlMermaidPlaceholder(): string {
  return 'ALL_FLOWS_HTML_MERMAID'
}

function leafFlowsHtmlPlaceholder(): string {
  return 'LEAF_FLOWS_HTML'
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

function formatFlow(flow: DocumentationFlow<any>): FormattedItem {
  return {
    id: flow.id,
    title: flow.title ?? humanizeId(flow.id),
    description: flow.description,
  }
}

function formatDemo(demo: DocumentationDemo<any>): FormattedItem {
  return {
    id: demo.id,
    title: demo.title ?? humanizeId(demo.id),
    description: demo.description,
  }
}

function formatStep(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  step: FlowStepInfo
): FormattedItem {
  const formatted = formatter == null ? defaultFormatter(step, flow.id) : formatter(step, flow.id)

  return {
    id: step.id,
    title: formatted.title,
    description: formatted.description,
  }
}

function templatePlaceholderToken(id: string): string {
  return `{{${id}}}`
}

function templateIncludes(template: string, placeholderId: string): boolean {
  return template.includes(templatePlaceholderToken(placeholderId))
}

function anchorForHeading(text: string): string {
  return slugify(text)
}

function headingLevelBeforeMarker<TFlows extends readonly AnyDocumentationFlow[]>(
  pageContent: readonly DocumentationSection<TFlows>[] | undefined,
  marker: string
): number | undefined {
  if (pageContent == null) {
    return undefined
  }

  let currentHeadingLevel: number | undefined

  for (const item of pageContent) {
    if (typeof item !== 'string' && item.kind === 'heading') {
      currentHeadingLevel = item.level
      continue
    }

    if (item === marker) {
      return currentHeadingLevel
    }
  }

  return undefined
}

function childHeadingLevel(parentHeadingLevel: number | undefined): number {
  return parentHeadingLevel == null ? 2 : parentHeadingLevel + 1
}

function flowAnchorBase(_formatter: DocumentationFormatter | undefined, flow: DocumentationFlow<any>): string {
  return slugify(formatFlow(flow).id || flow.id)
}

function demoAnchorBase(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  demo: DocumentationDemo<any>
): string {
  return slugify(`${flowAnchorBase(formatter, flow)}-${formatDemo(demo).id || demo.id}`)
}

function anchorForExamplePart(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  suffix: string
): string {
  return `${flowAnchorBase(formatter, flow)}-${suffix}`
}

function anchorForDemoPart(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  demo: DocumentationDemo<any>,
  suffix: string
): string {
  return `${demoAnchorBase(formatter, flow, demo)}-${suffix}`
}

function anchorForFlowSection(formatter: DocumentationFormatter | undefined, flow: DocumentationFlow<any>): string {
  return `${flowAnchorBase(formatter, flow)}-flow`
}

function firstUsedExampleAnchor(
  template: string,
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>
): string | null {
  const candidates: Array<[string, string]> = [
    [flowHtmlPlaceholder(flow.id), anchorForExamplePart(formatter, flow, 'flow-html')],
    [codePlaceholder(flow.id), anchorForExamplePart(formatter, flow, 'code-block')],
    [staticGraphPlaceholder(flow.id), anchorForExamplePart(formatter, flow, 'static-graph')],
    [flowJsonPlaceholder(flow.id), anchorForExamplePart(formatter, flow, 'flow-json')],
  ]

  return candidates.find(([placeholder]) => templateIncludes(template, placeholder))?.[1] ?? null
}

function firstUsedDemoAnchor(
  template: string,
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  demo: DocumentationDemo<any>
): string | null {
  const candidates: Array<[string, string]> = [
    [demoFullTablePlaceholder(flow.id, demo.id), anchorForDemoPart(formatter, flow, demo, 'full-table')],
    [demoResultHtmlPlaceholder(flow.id, demo.id), anchorForDemoPart(formatter, flow, demo, 'result-html')],
    [demoResultMermaidPlaceholder(flow.id, demo.id), anchorForDemoPart(formatter, flow, demo, 'result-mermaid')],
    [demoResultJsonPlaceholder(flow.id, demo.id), anchorForDemoPart(formatter, flow, demo, 'result-json')],
    [demoInitJsonPlaceholder(flow.id, demo.id), anchorForDemoPart(formatter, flow, demo, 'init-json')],
  ]

  return candidates.find(([placeholder]) => templateIncludes(template, placeholder))?.[1] ?? null
}

function renderTableStepLabel(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  step: FlowStepInfo
): string {
  const formatted = formatStep(formatter, flow, step)

  return [
    `<div><strong>${escapeHtml(formatted.title)}</strong></div>`,
    `<div style="margin-top:2px;color:#475569;font-size:12px;">${escapeHtml(formatted.id)}</div>`,
    formatted.description == null
      ? ''
      : `<div style="margin-top:4px;color:#334155;font-size:13px;">${escapeHtml(formatted.description)}</div>`,
  ].join('')
}

function getBranchEntries(step: FlowStepInfo): Array<[PropertyKey, FlowLike]> {
  if (!(step instanceof StepBranchInfo)) {
    return []
  }

  return getOwnEntries(step.branches)
}

function renderStaticBranchColumns(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  step: FlowStepInfo
): string {
  const entries = getBranchEntries(step)

  if (entries.length === 0) {
    return '<div style="color:#94a3b8;">-</div>'
  }

  const columnHtml = entries
    .map(([key, flow]) => {
      const nestedDocumentationFlow = createNestedFlowExample(formatter, flow)
      const nestedTable = renderStaticFlowLayoutTable(formatter, nestedDocumentationFlow, flow.steps)

      return `<div style="border:1px solid #d0d7de;border-radius:6px;padding:10px;background:#f8fafc;">
<div><strong>${escapeHtml(String(key))}</strong></div>
${flow.steps.length === 0 ? '' : `<div style="margin-top:8px;">${nestedTable}</div>`}
</div>`
    })
    .join('')

  return `<div style="display:grid;grid-template-columns:repeat(${entries.length},minmax(0,1fr));gap:12px;${
    entries.length === 1 ? 'padding-left:12px;' : ''
  }">${columnHtml}</div>`
}

function renderStaticFlowLayoutRows(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  steps: readonly FlowStepInfo[]
): string {
  return steps
    .map(
      (step) => `<tr>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;width:32%;">${renderTableStepLabel(formatter, flow, step)}</td>
<td style="padding:10px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStaticBranchColumns(formatter, flow, step)}</td>
</tr>`
    )
    .join('')
}

function renderStaticFlowLayoutTable(
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  steps: readonly FlowStepInfo[]
): string {
  return [
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">',
    '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;width:32%;">Step</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Branches</th></tr></thead>',
    `<tbody>${renderStaticFlowLayoutRows(formatter, flow, steps)}</tbody>`,
    '</table>',
  ].join('')
}

function renderStaticFlowHtmlBlock(
  markerId: string,
  anchorId: string,
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  steps: readonly FlowStepInfo[]
): string {
  return wrapWithAnchor(
    anchorId,
    wrapGeneratedBlock(markerId, 'html-table', renderStaticFlowLayoutTable(formatter, flow, steps))
  )
}

function renderDemoResultParts(
  markerId: string,
  runInput: unknown,
  result: Pick<FlowResult<any>, 'status' | 'stepResults'>,
  convertedResult: ConvertedFlowResult,
  failedStepIds: string[]
) {
  return {
    initJson: [
      '<p><strong>Initial flow.run() input</strong></p>',
      renderJsonCodeBlock(`${markerId}-init`, runInput),
    ].join('\n'),
    resultJson: [
      '<p><strong>Resulting JSON</strong></p>',
      renderJsonCodeBlock(`${markerId}-result`, {
        ...convertedResult,
        failedStepIds,
      }),
    ].join('\n'),
    resultMermaid: renderMermaidBlock(markerId, renderProcessAsMermaidGraph(result)),
    resultHtml: renderResultTable(markerId, convertedResult, failedStepIds),
  }
}

function renderDemoResultSection(
  markerId: string,
  runInput: unknown,
  result: Pick<FlowResult<any>, 'status' | 'stepResults'>,
  convertedResult: ConvertedFlowResult,
  failedStepIds: string[]
): string {
  const parts = renderDemoResultParts(markerId, runInput, result, convertedResult, failedStepIds)

  return renderThreeColumnHtml(
    renderMarkdownPane([parts.initJson, '', parts.resultJson].join('\n')),
    renderMarkdownPane(parts.resultMermaid),
    parts.resultHtml
  )
}

type LeafFlowEntry = {
  flow: FlowLike
  referencedBy: DocumentationFlow<any>[]
}

function createNestedFlowExample(
  formatter: DocumentationFormatter | undefined,
  flow: FlowLike
): DocumentationFlow<any> {
  const firstStep = flow.steps[0]

  if (firstStep == null) {
    return {
      id: 'empty-flow',
      title: 'Empty flow',
      flow,
    }
  }

  const nestedFlow: DocumentationFlow<any> = {
    id: firstStep.id,
    title: firstStep.id,
    flow,
  }
  const formattedStep = formatStep(formatter, nestedFlow, firstStep)

  return {
    id: firstStep.id,
    title: formattedStep.title,
    description: formattedStep.description,
    flow,
  }
}

function collectNestedFlows(flows: readonly DocumentationFlow<any>[]): LeafFlowEntry[] {
  const rootFlows = new Set(flows.map((flow) => flow.flow))
  const nestedFlows = new Map<FlowLike, LeafFlowEntry>()

  for (const flow of flows) {
    const visited = new Set<FlowLike>()
    const pending = [flow.flow]

    while (pending.length > 0) {
      const currentFlow = pending.pop()

      if (currentFlow == null || visited.has(currentFlow)) {
        continue
      }

      visited.add(currentFlow)

      for (const step of currentFlow.steps) {
        for (const branchFlow of Object.values(step instanceof StepBranchInfo ? step.branches : {}) as FlowLike[]) {
          pending.push(branchFlow)

          if (rootFlows.has(branchFlow)) {
            continue
          }

          const existing = nestedFlows.get(branchFlow)

          if (existing == null) {
            nestedFlows.set(branchFlow, {
              flow: branchFlow,
              referencedBy: [flow],
            })
            continue
          }

          if (!existing.referencedBy.some((entry) => entry.id === flow.id)) {
            existing.referencedBy.push(flow)
          }
        }
      }
    }
  }

  return [...nestedFlows.values()]
}

function renderFlowHeading(level: number, formatter: DocumentationFormatter | undefined, flow: DocumentationFlow<any>) {
  const formatted = formatFlow(flow)
  const description = formatted.description == null ? '' : `\n\n${formatted.description}`

  return `${'#'.repeat(level)} ${formatted.title}${description}`
}

function renderReferencedByList(
  formatter: DocumentationFormatter | undefined,
  referencedBy: readonly DocumentationFlow<any>[]
) {
  if (referencedBy.length === 0) {
    return ''
  }

  return ['**Referenced from**', '', ...referencedBy.map((flow) => `- ${formatFlow(flow).title}`)].join('\n')
}

function renderAllFlowsHtmlMermaid(
  formatter: DocumentationFormatter | undefined,
  flows: readonly DocumentationFlow<any>[],
  parentHeadingLevel?: number
): string {
  const flowHeadingLevel = childHeadingLevel(parentHeadingLevel)

  return flows
    .map((flow) => {
      return [
        wrapWithAnchor(anchorForFlowSection(formatter, flow), renderFlowHeading(flowHeadingLevel, formatter, flow)),
        '',
        wrapGeneratedBlock(
          replaceKeyToMarkerId(flowHtmlPlaceholder(flow.id)),
          'html-table',
          renderStaticFlowLayoutTable(formatter, flow, flow.flow.steps)
        ),
        '',
        renderMermaidBlock(
          replaceKeyToMarkerId(staticGraphPlaceholder(flow.id)),
          renderProcessAsMermaidGraph(flow.flow)
        ),
      ].join('\n')
    })
    .join('\n\n')
}

function renderLeafFlowsHtml(
  formatter: DocumentationFormatter | undefined,
  flows: readonly DocumentationFlow<any>[],
  parentHeadingLevel?: number
): string {
  const leafFlows = collectNestedFlows(flows)
  const sectionHeadingLevel = childHeadingLevel(parentHeadingLevel)
  const leafFlowHeadingLevel = childHeadingLevel(sectionHeadingLevel)

  if (leafFlows.length === 0) {
    return `${'#'.repeat(sectionHeadingLevel)} Referenced leaf flows\n\nNo leaf flows referenced from root examples.`
  }

  return [
    `${'#'.repeat(sectionHeadingLevel)} Referenced leaf flows`,
    '',
    ...leafFlows.flatMap((leafFlow) => {
      const leafDoc = createNestedFlowExample(formatter, leafFlow.flow)
      const referencedBy = renderReferencedByList(formatter, leafFlow.referencedBy)

      return [
        wrapWithAnchor(
          anchorForFlowSection(formatter, leafDoc),
          renderFlowHeading(leafFlowHeadingLevel, formatter, leafDoc)
        ),
        '',
        referencedBy,
        wrapGeneratedBlock(
          replaceKeyToMarkerId(flowHtmlPlaceholder(leafDoc.id)),
          'html-table',
          renderStaticFlowLayoutTable(formatter, leafDoc, leafDoc.flow.steps)
        ),
        '',
      ]
    }),
  ].join('\n')
}

function tocLinesForMarker(
  marker: string,
  template: string,
  formatter: DocumentationFormatter | undefined,
  flows: readonly DocumentationFlow<any>[]
): string[] {
  if (marker === allFlowsHtmlMermaidPlaceholder()) {
    return flows.map((flow) => `- [${formatFlow(flow).title}](#${anchorForFlowSection(formatter, flow)})`)
  }

  if (marker === leafFlowsHtmlPlaceholder()) {
    return collectNestedFlows(flows).map((leafFlow) => {
      const leafDoc = createNestedFlowExample(formatter, leafFlow.flow)
      return `- [${formatFlow(leafDoc).title}](#${anchorForFlowSection(formatter, leafDoc)})`
    })
  }

  const flow = flows.find((entry) => entry.id === marker.replace(/_(CODE_BLOCK|FLOW_JSON|STATIC_GRAPH|FLOW_HTML)$/, ''))
  if (flow != null) {
    const flowAnchor = firstUsedExampleAnchor(template, formatter, flow) ?? anchorForFlowSection(formatter, flow)
    return [`- [${formatFlow(flow).title}](#${flowAnchor})`]
  }

  for (const flowEntry of flows) {
    for (const demo of flowEntry.demos ?? []) {
      const demoMarkers = [
        demoFullTablePlaceholder(flowEntry.id, demo.id),
        demoInitJsonPlaceholder(flowEntry.id, demo.id),
        demoResultJsonPlaceholder(flowEntry.id, demo.id),
        demoResultMermaidPlaceholder(flowEntry.id, demo.id),
        demoResultHtmlPlaceholder(flowEntry.id, demo.id),
      ]

      if (demoMarkers.includes(marker)) {
        const demoAnchor = firstUsedDemoAnchor(template, formatter, flowEntry, demo)
        if (demoAnchor == null) {
          return []
        }

        return [`- [${formatDemo(demo).title}](#${demoAnchor})`]
      }
    }
  }

  return []
}

function renderStructuredToc<const TFlows extends readonly AnyDocumentationFlow[]>(
  template: string,
  formatter: DocumentationFormatter | undefined,
  flows: TFlows,
  pageContent: readonly DocumentationSection<TFlows>[]
): string {
  const lines: string[] = []
  let currentHeadingLevel = 0

  for (const item of pageContent) {
    if (typeof item !== 'string' && item.kind === 'heading') {
      currentHeadingLevel = item.level
      lines.push(`${'  '.repeat(Math.max(0, item.level - 1))}- [${item.text}](#${anchorForHeading(item.text)})`)
      continue
    }

    if (typeof item !== 'string') {
      continue
    }

    if (item === tocPlaceholder()) {
      continue
    }

    const childIndent = '  '.repeat(currentHeadingLevel)

    for (const line of tocLinesForMarker(item, template, formatter, flows)) {
      lines.push(childIndent === '' ? line : line.replace(/^- /, `${childIndent}- `))
    }
  }

  return lines.join('\n')
}

function renderToc<const TFlows extends readonly AnyDocumentationFlow[]>(
  template: string,
  formatter: DocumentationFormatter | undefined,
  flows: TFlows,
  pageContent?: readonly DocumentationSection<TFlows>[]
) {
  if (pageContent != null) {
    return renderStructuredToc(template, formatter, flows, pageContent)
  }

  const lines: string[] = []
  const rootFlowSectionIncluded = templateIncludes(template, allFlowsHtmlMermaidPlaceholder())
  const leafFlowSectionIncluded = templateIncludes(template, leafFlowsHtmlPlaceholder())

  for (const flow of flows) {
    const flowInfo = formatFlow(flow)
    const exampleAnchor = rootFlowSectionIncluded
      ? anchorForFlowSection(formatter, flow)
      : firstUsedExampleAnchor(template, formatter, flow)

    if (exampleAnchor == null && (flow.demos?.length ?? 0) === 0) {
      continue
    }

    lines.push(exampleAnchor == null ? `- ${flowInfo.title}` : `- [${flowInfo.title}](#${exampleAnchor})`)

    for (const demo of flow.demos ?? []) {
      const demoInfo = formatDemo(demo)
      const demoAnchor = firstUsedDemoAnchor(template, formatter, flow, demo)
      if (demoAnchor == null) {
        continue
      }

      lines.push(demoAnchor == null ? `  - ${demoInfo.title}` : `  - [${demoInfo.title}](#${demoAnchor})`)
    }
  }

  if (leafFlowSectionIncluded) {
    for (const leafFlow of collectNestedFlows(flows)) {
      const leafDoc = createNestedFlowExample(formatter, leafFlow.flow)
      const leafInfo = formatFlow(leafDoc)
      lines.push(`- [${leafInfo.title}](#${anchorForFlowSection(formatter, leafDoc)})`)
    }
  }

  return lines.join('\n')
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
  flows: readonly DocumentationFlow<any>[]
) {
  console.log('GLOBAL:')
  console.log(`- output in ${templateFile}:`)
  console.log(
    `  - ${formatUsage(templatePlaceholderToken(tocPlaceholder()), templateIncludes(template, tocPlaceholder()))}`
  )
  console.log(
    `  - ${formatUsage(
      templatePlaceholderToken(allFlowsHtmlMermaidPlaceholder()),
      templateIncludes(template, allFlowsHtmlMermaidPlaceholder())
    )}`
  )
  console.log(
    `  - ${formatUsage(
      templatePlaceholderToken(leafFlowsHtmlPlaceholder()),
      templateIncludes(template, leafFlowsHtmlPlaceholder())
    )}`
  )

  for (const flow of flows) {
    const flowSourceFile = flow.sourceFile ?? defaultSourceFile
    const flowMarkers: MarkerReportEntry[] = [
      {
        marker: templatePlaceholderToken(codePlaceholder(flow.id)),
        used: templateIncludes(template, codePlaceholder(flow.id)),
      },
      {
        marker: templatePlaceholderToken(flowHtmlPlaceholder(flow.id)),
        used: templateIncludes(template, flowHtmlPlaceholder(flow.id)),
      },
      {
        marker: templatePlaceholderToken(staticGraphPlaceholder(flow.id)),
        used: templateIncludes(template, staticGraphPlaceholder(flow.id)),
      },
      {
        marker: templatePlaceholderToken(flowJsonPlaceholder(flow.id)),
        used: templateIncludes(template, flowJsonPlaceholder(flow.id)),
      },
    ]

    console.log(`${flow.id}:`)
    console.log(
      `- source code in ${flowSourceFile}: ${sourceMarker(flow.id, 'START')} / ${sourceMarker(flow.id, 'END')}`
    )
    console.log(`- output in ${templateFile}:`)
    console.log('  - flow markers:')
    for (const entry of flowMarkers) {
      console.log(`    - ${formatUsage(entry.marker, entry.used)}`)
    }
    console.log('  - demos:')
    for (const demo of flow.demos ?? []) {
      const demoName = demoBase(flow.id, demo.id)
      const demoMarkers: MarkerReportEntry[] = [
        {
          marker: templatePlaceholderToken(demoFullTablePlaceholder(flow.id, demo.id)),
          used: templateIncludes(template, demoFullTablePlaceholder(flow.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoInitJsonPlaceholder(flow.id, demo.id)),
          used: templateIncludes(template, demoInitJsonPlaceholder(flow.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoResultJsonPlaceholder(flow.id, demo.id)),
          used: templateIncludes(template, demoResultJsonPlaceholder(flow.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoResultMermaidPlaceholder(flow.id, demo.id)),
          used: templateIncludes(template, demoResultMermaidPlaceholder(flow.id, demo.id)),
        },
        {
          marker: templatePlaceholderToken(demoResultHtmlPlaceholder(flow.id, demo.id)),
          used: templateIncludes(template, demoResultHtmlPlaceholder(flow.id, demo.id)),
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
  formatter: DocumentationFormatter | undefined,
  flow: DocumentationFlow<any>,
  demoRenders: readonly DemoRender<any>[]
): Promise<string> {
  let nextMarkdown = markdown
  const exampleCode = readCodeBlockFromSource(flow.sourceFile ?? sourceFile, flow.id)
  const exampleCodeAnchor = anchorForExamplePart(formatter, flow, 'code-block')
  const exampleFlowHtmlAnchor = anchorForExamplePart(formatter, flow, 'flow-html')
  const exampleStaticGraphAnchor = anchorForExamplePart(formatter, flow, 'static-graph')
  const exampleFlowJsonAnchor = anchorForExamplePart(formatter, flow, 'flow-json')

  if (templateIncludes(nextMarkdown, codePlaceholder(flow.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(codePlaceholder(flow.id)),
      wrapWithAnchor(exampleCodeAnchor, ['```ts', escapeMarkdownCodeBlock(exampleCode), '```'].join('\n'))
    )
  }

  if (templateIncludes(nextMarkdown, flowJsonPlaceholder(flow.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(flowJsonPlaceholder(flow.id)),
      wrapWithAnchor(
        exampleFlowJsonAnchor,
        renderFlowConfigurationJson(replaceKeyToMarkerId(flowJsonPlaceholder(flow.id)), flow.flow)
      )
    )
  }

  if (templateIncludes(nextMarkdown, staticGraphPlaceholder(flow.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(staticGraphPlaceholder(flow.id)),
      wrapWithAnchor(
        exampleStaticGraphAnchor,
        renderThreeColumnHtml(
          '<p><strong>Result JSON</strong><br>No run result yet.</p>',
          renderMarkdownPane(
            renderMermaidBlock(
              replaceKeyToMarkerId(staticGraphPlaceholder(flow.id)),
              renderProcessAsMermaidGraph(flow.flow)
            )
          ),
          renderStaticFlowLayoutTable(formatter, flow, flow.flow.steps)
        )
      )
    )
  }

  if (templateIncludes(nextMarkdown, flowHtmlPlaceholder(flow.id))) {
    nextMarkdown = nextMarkdown.replace(
      templatePlaceholderToken(flowHtmlPlaceholder(flow.id)),
      renderStaticFlowHtmlBlock(
        replaceKeyToMarkerId(flowHtmlPlaceholder(flow.id)),
        exampleFlowHtmlAnchor,
        formatter,
        flow,
        flow.flow.steps
      )
    )
  }

  for (const rendered of demoRenders) {
    const markerId = replaceKeyToMarkerId(demoBase(flow.id, rendered.demo.id))
    const runInput = rendered.demo.ctx === undefined ? rendered.demo.init : { data: rendered.demo.init, ctx: rendered.demo.ctx }
    const parts = renderDemoResultParts(
      markerId,
      runInput,
      rendered.result,
      rendered.convertedResult,
      rendered.failedStepIds
    )

    if (templateIncludes(nextMarkdown, demoFullTablePlaceholder(flow.id, rendered.demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoFullTablePlaceholder(flow.id, rendered.demo.id)),
        wrapWithAnchor(
          anchorForDemoPart(formatter, flow, rendered.demo, 'full-table'),
          renderDemoResultSection(
            markerId,
            runInput,
            rendered.result,
            rendered.convertedResult,
            rendered.failedStepIds
          )
        )
      )
    }

    if (templateIncludes(nextMarkdown, demoInitJsonPlaceholder(flow.id, rendered.demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoInitJsonPlaceholder(flow.id, rendered.demo.id)),
        wrapWithAnchor(anchorForDemoPart(formatter, flow, rendered.demo, 'init-json'), parts.initJson)
      )
    }

    if (templateIncludes(nextMarkdown, demoResultJsonPlaceholder(flow.id, rendered.demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoResultJsonPlaceholder(flow.id, rendered.demo.id)),
        wrapWithAnchor(anchorForDemoPart(formatter, flow, rendered.demo, 'result-json'), parts.resultJson)
      )
    }

    if (templateIncludes(nextMarkdown, demoResultMermaidPlaceholder(flow.id, rendered.demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoResultMermaidPlaceholder(flow.id, rendered.demo.id)),
        wrapWithAnchor(anchorForDemoPart(formatter, flow, rendered.demo, 'result-mermaid'), parts.resultMermaid)
      )
    }

    if (templateIncludes(nextMarkdown, demoResultHtmlPlaceholder(flow.id, rendered.demo.id))) {
      nextMarkdown = nextMarkdown.replace(
        templatePlaceholderToken(demoResultHtmlPlaceholder(flow.id, rendered.demo.id)),
        wrapWithAnchor(anchorForDemoPart(formatter, flow, rendered.demo, 'result-html'), parts.resultHtml)
      )
    }
  }

  return nextMarkdown
}

async function renderAllDemoRenders(
  flows: readonly DocumentationFlow<any>[]
): Promise<ReadonlyMap<string, readonly DemoRender<any>[]>> {
  return new Map(
    await Promise.all(
      flows.map(async (flow) => {
        const demoRenders = await Promise.all(
          (flow.demos ?? []).map(async (demo) => {
            const result = demo.ctx === undefined ? await flow.flow.run(demo.init) : await flow.flow.run(demo.init, demo.ctx)
            const failedStepIds = collectFailedStepIds(result.stepResults)
            return {
              demo,
              result,
              convertedResult: convertResultNode(result) as ConvertedFlowResult,
              failedStepIds,
            } satisfies DemoRender<any>
          })
        )

        return [flow.id, demoRenders] as const
      })
    )
  )
}

async function renderMarkdownDocumentation<const TFlows extends readonly AnyDocumentationFlow[]>({
  template,
  sourceFile,
  formatter,
  flows = [] as unknown as TFlows,
  pageContent,
}: RenderMarkdownDocumentationOptions<TFlows>): Promise<string> {
  let markdown = template
  const demoRendersByExampleId = await renderAllDemoRenders(flows)

  if (templateIncludes(markdown, tocPlaceholder())) {
    markdown = markdown.replace(
      templatePlaceholderToken(tocPlaceholder()),
      renderToc(template, formatter, flows, pageContent)
    )
  }

  if (templateIncludes(markdown, allFlowsHtmlMermaidPlaceholder())) {
    markdown = markdown.replace(
      templatePlaceholderToken(allFlowsHtmlMermaidPlaceholder()),
      renderAllFlowsHtmlMermaid(
        formatter,
        flows,
        headingLevelBeforeMarker(pageContent, allFlowsHtmlMermaidPlaceholder())
      )
    )
  }

  if (templateIncludes(markdown, leafFlowsHtmlPlaceholder())) {
    markdown = markdown.replace(
      templatePlaceholderToken(leafFlowsHtmlPlaceholder()),
      renderLeafFlowsHtml(formatter, flows, headingLevelBeforeMarker(pageContent, leafFlowsHtmlPlaceholder()))
    )
  }

  for (const flow of flows) {
    markdown = await renderGeneratedExample(
      markdown,
      sourceFile,
      formatter,
      flow,
      demoRendersByExampleId.get(flow.id) ?? []
    )
  }

  return markdown
}

export function h1(text: string): HeadingSection {
  return {
    kind: 'heading',
    level: 1,
    text,
  }
}

export function p(text: string): ParagraphSection {
  return {
    kind: 'p',
    text,
  }
}

export async function writeMarkdownDocumentation<const TFlows extends readonly AnyDocumentationFlow[]>({
  documentationSourceFile,
  outputFile,
  printReport = false,
  ...renderOptions
}: WriteMarkdownDocumentationOptions<TFlows>): Promise<void> {
  const template =
    'templateFile' in renderOptions && renderOptions.templateFile != null
      ? readFileSync(renderOptions.templateFile, 'utf8')
      : renderPageContent(renderOptions.pageContent)

  if (printReport) {
    logMarkerReport(
      template,
      'templateFile' in renderOptions && renderOptions.templateFile != null
        ? renderOptions.templateFile
        : '[pageContent]',
      documentationSourceFile,
      renderOptions.flows ?? []
    )
  }

  writeFileSync(
    outputFile,
    await renderMarkdownDocumentation({
      template,
      sourceFile: documentationSourceFile,
      flows: renderOptions.flows,
      formatter: renderOptions.formatter,
      pageContent: 'pageContent' in renderOptions ? renderOptions.pageContent : undefined,
    })
  )
}
