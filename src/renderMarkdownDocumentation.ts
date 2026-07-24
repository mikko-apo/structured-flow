import { readFileSync, writeFileSync } from 'node:fs'

import type { FlowResult } from './flowClasses.ts'
import { renderProcessAsMermaidGraph } from './renderMermaid.ts'
import { getOwnEntries } from './utils.ts'
import {
  convertResultNode,
  type ConvertedBranchStepFlowResult,
  type ConvertedFlowResult,
  type ConvertedStepResult,
  type FlattenedFailedStepResult,
  flattenStepResults,
} from './resultUtils.ts'

type FlowStructure = {
  steps: readonly FlowStepInfo[]
}

type FlowLike = FlowStructure & {
  options?: {
    name?: string
    description?: string
  }
  run(...args: any[]): Promise<FlowResult> | FlowResult
}

type FlowStepInfo = {
  id?: string
  rawId?: unknown
  options?: {
    name?: string
    description?: string
  }
  branches?: Record<PropertyKey, FlowStructure>
}

type SourceFiles = string | string[]

type DocumentationDemoFields<Data extends object> = {
  placeholderId: string
  data: Data
  title?: string
  description?: string
}

export type DocumentationDemo<TFlow extends FlowLike> =
  Parameters<TFlow['run']> extends [data: infer Data extends object, ctx: infer Ctx]
    ? DocumentationDemoFields<Data> & { ctx: Ctx }
    : Parameters<TFlow['run']> extends [data: infer Data extends object]
      ? DocumentationDemoFields<Data> & { ctx?: never }
      : never

export type DocumentationFlow<TFlow extends FlowLike> = {
  placeholderId: string
  sourceFiles?: SourceFiles
  flow: TFlow
  /** Overrides flow.options.name; required by writeMarkdownDocumentation() when the flow has no name. */
  title?: string
  /** Overrides flow.options.description; required by writeMarkdownDocumentation() when the flow has no description. */
  description?: string
  demos?: readonly DocumentationDemo<TFlow>[]
}

type AnyDocumentationDemo = DocumentationDemoFields<any> & { ctx?: unknown }

type AnyDocumentationFlow = Omit<DocumentationFlow<FlowLike>, 'demos'> & {
  demos?: readonly AnyDocumentationDemo[]
}

type TypeCheckedDocumentationFlows<TFlows extends readonly AnyDocumentationFlow[]> = {
  [Index in keyof TFlows]: TFlows[Index] extends infer DocumentationFlowEntry extends AnyDocumentationFlow
    ? Omit<DocumentationFlowEntry, 'demos'> & {
        demos?: readonly DocumentationDemo<DocumentationFlowEntry['flow']>[]
      }
    : never
}

type FormattedItem = {
  placeholderId: string
  title: string
  description?: string
}

type FormattedStepItem = {
  title: string
  description?: string
}

type HeadingSection = {
  kind: 'heading'
  level: number
  text: string
}

type ParagraphSection = {
  kind: 'p'
  text: string
}

type RuntimeDocumentationSection = string | HeadingSection | ParagraphSection

export type DocumentationSection<TFlows extends readonly AnyDocumentationFlow[]> =
  | 'TOC'
  | 'ALL_FLOWS_HTML_MERMAID'
  | 'LEAF_FLOWS_HTML'
  | `${TFlows[number]['placeholderId']}_CODE_BLOCK`
  | `${TFlows[number]['placeholderId']}_FLOW_JSON`
  | `${TFlows[number]['placeholderId']}_STATIC_GRAPH`
  | `${TFlows[number]['placeholderId']}_FLOW_HTML`
  | `${TFlows[number]['placeholderId']}_${NonNullable<TFlows[number]['demos']>[number]['placeholderId']}_FULL_TABLE`
  | `${TFlows[number]['placeholderId']}_${NonNullable<TFlows[number]['demos']>[number]['placeholderId']}_INIT_JSON`
  | `${TFlows[number]['placeholderId']}_${NonNullable<TFlows[number]['demos']>[number]['placeholderId']}_RESULT_JSON`
  | `${TFlows[number]['placeholderId']}_${NonNullable<TFlows[number]['demos']>[number]['placeholderId']}_RESULT_MERMAID`
  | `${TFlows[number]['placeholderId']}_${NonNullable<TFlows[number]['demos']>[number]['placeholderId']}_RESULT_HTML`
  | HeadingSection
  | ParagraphSection

export type DocumentationFormatter<TNode extends FlowStepInfo = FlowStepInfo> = (
  node: TNode,
  flowPlaceholderId: string
) => FormattedStepItem

export type RenderMarkdownDocumentationOptions<
  TFlows extends readonly AnyDocumentationFlow[] = readonly AnyDocumentationFlow[],
> = {
  template: string
  sourceFiles: SourceFiles
  formatter?: DocumentationFormatter<TFlows[number]['flow']['steps'][number]>
  flows?: TFlows & TypeCheckedDocumentationFlows<TFlows>
  pageContent?: readonly DocumentationSection<TFlows>[]
}

export type WriteMarkdownDocumentationOptions<
  TFlows extends readonly AnyDocumentationFlow[] = readonly AnyDocumentationFlow[],
> = Omit<RenderMarkdownDocumentationOptions<TFlows>, 'template' | 'pageContent'> & {
  outputFile: string
  printReport?: boolean
} & (
    | {
        templateFile: string
        pageContent?: never
      }
    | {
        templateFile?: never
        pageContent: readonly DocumentationSection<TFlows>[]
      }
  )

type DemoRender = {
  demo: AnyDocumentationDemo
  result: FlowResult
  convertedResult: ConvertedFlowResult
  failedStepResults: FlattenedFailedStepResult[]
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

function formatRuleId(ruleId: unknown): string | undefined {
  if (typeof ruleId === 'string') {
    return ruleId
  }

  return ruleId != null && typeof ruleId === 'object' && 'id' in ruleId && typeof ruleId.id === 'string'
    ? ruleId.id
    : undefined
}

function isBranchStep(step: Pick<FlowStepInfo, 'branches'> | Pick<ConvertedStepResult, 'branches'>): boolean {
  return step.branches != null
}

function renderStepTitleWithMetadata(stepResult: ConvertedStepResult): string {
  const title = String(stepResult.name ?? stepResult.id)
  const ruleId = stepResult.ruleId
  const metadataHtml =
    ruleId === undefined
      ? ''
      : `<div style="margin-top:2px;color:#475569;font-size:12px;">${escapeHtml(`ruleId: ${ruleId}`)}</div>`

  return `${escapeHtml(title)}${metadataHtml}`
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

function wrapGeneratedBlock(markerId: string, kind: 'json' | 'mermaid' | 'html-table', content: string): string {
  return [
    `<!-- structured-process-demo:${markerId}:${kind}:start -->`,
    content,
    `<!-- structured-process-demo:${markerId}:${kind}:end -->`,
  ].join('\n')
}

function wrapWithAnchor(anchorId: string, content: string): string {
  return [`<a id="${escapeHtml(anchorId)}"></a>`, content].join('\n')
}

function renderPageContent(pageContent: readonly RuntimeDocumentationSection[]): string {
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

function renderTwoColumnHtml(firstHtml: string, secondHtml: string): string {
  return [
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;">',
    `<div>${firstHtml}</div>`,
    `<div>${secondHtml}</div>`,
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
          : result.status === 'fail'
            ? 'completed with failures'
            : result.status === 'ok'
              ? 'successful sequence run'
              : 'done'

  const badgeType =
    result.status === 'exception' || result.status === 'fail'
      ? 'fail'
      : result.status === 'stop'
        ? 'stop'
        : result.status === 'skip'
          ? 'skip'
          : 'ok'

  return renderStatusBadge(badgeType).replace(`>${escapeHtml(badgeType)}<`, `>${escapeHtml(label)}<`)
}

function renderStepPayload(stepResult: Pick<ConvertedStepResult, 'variables'>): string {
  return stepResult.variables == null || Object.keys(stepResult.variables).length === 0
    ? ''
    : JSON.stringify(stepResult.variables)
}

function renderBranchStepDetails(stepResults: ConvertedBranchStepFlowResult['stepResults'], depth: number): string {
  if (stepResults.length === 0) {
    return '<div style="margin-top:4px;color:#64748b;">No branch steps recorded.</div>'
  }

  return stepResults
    .map(
      (stepResult) => `<div style="margin-top:4px;padding-left:${depth * 12}px;">
<div>${renderStepTitleWithMetadata(stepResult)}${escapeHtml(`: ${formatDescription(stepResult.description)}`)} ${renderStatusBadge(String(stepResult.status))}</div>
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
  failedStepResults: readonly FlattenedFailedStepResult[]
): string {
  const rowsHtml = result.stepResults
    .map(
      (stepResult) => `<tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStepTitleWithMetadata(stepResult)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(formatDescription(stepResult.description))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStatusBadge(String(stepResult.status))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(renderStepPayload(stepResult))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderBranchDetails(stepResult.branches)}</td>
</tr>`
    )
    .join('')

  const failedStepRows =
    failedStepResults.length === 0
      ? '<tr><td colspan="6" style="padding:8px;border-bottom:1px solid #d0d7de;color:#64748b;">No failed step results.</td></tr>'
      : failedStepResults
          .map(
            (failedStepResult) => `<tr>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(failedStepResult.path ?? '')}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(failedStepResult.id)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${renderStatusBadge(failedStepResult.status)}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(formatDescription(failedStepResult.description))}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(failedStepResult.message ?? '')}</td>
<td style="padding:8px;border-bottom:1px solid #d0d7de;vertical-align:top;">${escapeHtml(JSON.stringify(failedStepResult.variables))}</td>
</tr>`
          )
          .join('')

  const failedStepResultsHtml = [
    '<p><strong>flattenStepResults()</strong></p>',
    '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">',
    '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Path</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Id</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Status</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Description</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Message</th><th style="text-align:left;padding:8px;border-bottom:1px solid #d0d7de;">Variables</th></tr></thead>',
    `<tbody>${failedStepRows}</tbody>`,
    '</table>',
  ].join('\n')

  return [
    `<p><strong>Overall outcome:</strong> ${renderOutcomeBadge(result as unknown as { status: string; stepResults: Array<{ status: string }> })}</p>`,
    failedStepResultsHtml,
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

function renderMermaidBlock(markerId: string, graph: string): string {
  return wrapGeneratedBlock(markerId, 'mermaid', ['```mermaid', graph, '```'].join('\n'))
}

function sourceMarker(placeholderId: string, boundary: 'START' | 'END'): string {
  return `/* ${placeholderId}:${boundary} */`
}

function sourceFileList(sourceFiles: SourceFiles): string[] {
  return typeof sourceFiles === 'string' ? [sourceFiles] : sourceFiles
}

function readCodeBlockFromSources(sourceFiles: SourceFiles, placeholderId: string): string {
  const startMarker = sourceMarker(placeholderId, 'START')
  const endMarker = sourceMarker(placeholderId, 'END')

  for (const sourceFile of sourceFileList(sourceFiles)) {
    const source = readFileSync(sourceFile, 'utf8')
    const startIndex = source.indexOf(startMarker)
    const endIndex = source.indexOf(endMarker)

    if (startIndex !== -1 && endIndex > startIndex) {
      return source.slice(startIndex + startMarker.length, endIndex).trim()
    }
  }

  throw new Error(
    `Source markers "${startMarker}" and "${endMarker}" were not found in ${sourceFileList(sourceFiles).join(', ')}`
  )
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

function codePlaceholder(flowPlaceholderId: string): string {
  return `${flowPlaceholderId}_CODE_BLOCK`
}

function flowJsonPlaceholder(flowPlaceholderId: string): string {
  return `${flowPlaceholderId}_FLOW_JSON`
}

function staticGraphPlaceholder(flowPlaceholderId: string): string {
  return `${flowPlaceholderId}_STATIC_GRAPH`
}

function flowHtmlPlaceholder(flowPlaceholderId: string): string {
  return `${flowPlaceholderId}_FLOW_HTML`
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

function demoBase(flowPlaceholderId: string, demoPlaceholderId: string): string {
  return `${flowPlaceholderId}_${demoPlaceholderId}`
}

function demoFullTablePlaceholder(flowPlaceholderId: string, demoPlaceholderId: string): string {
  return `${demoBase(flowPlaceholderId, demoPlaceholderId)}_FULL_TABLE`
}

function demoInitJsonPlaceholder(flowPlaceholderId: string, demoPlaceholderId: string): string {
  return `${demoBase(flowPlaceholderId, demoPlaceholderId)}_INIT_JSON`
}

function demoResultJsonPlaceholder(flowPlaceholderId: string, demoPlaceholderId: string): string {
  return `${demoBase(flowPlaceholderId, demoPlaceholderId)}_RESULT_JSON`
}

function demoResultMermaidPlaceholder(flowPlaceholderId: string, demoPlaceholderId: string): string {
  return `${demoBase(flowPlaceholderId, demoPlaceholderId)}_RESULT_MERMAID`
}

function demoResultHtmlPlaceholder(flowPlaceholderId: string, demoPlaceholderId: string): string {
  return `${demoBase(flowPlaceholderId, demoPlaceholderId)}_RESULT_HTML`
}

function formatFlow(flow: AnyDocumentationFlow): FormattedItem {
  return {
    placeholderId: flow.placeholderId,
    title: flow.title ?? flow.flow.options?.name ?? humanizeId(flow.placeholderId),
    description: flow.description ?? flow.flow.options?.description,
  }
}

function validateFlowMetadata(flows: readonly AnyDocumentationFlow[]): void {
  for (const flow of flows) {
    if (flow.title == null && flow.flow.options?.name == null) {
      throw new Error(
        `Documentation flow "${flow.placeholderId}" requires a title because its flow does not have a name`
      )
    }

    if (flow.description == null && flow.flow.options?.description == null) {
      throw new Error(
        `Documentation flow "${flow.placeholderId}" requires a description because its flow does not have a description`
      )
    }
  }
}

function formatDemo(demo: AnyDocumentationDemo): FormattedItem {
  return {
    placeholderId: demo.placeholderId,
    title: demo.title ?? humanizeId(demo.placeholderId),
    description: demo.description,
  }
}

function formatStep(
  formatter: DocumentationFormatter | undefined,
  flow: AnyDocumentationFlow,
  step: FlowStepInfo
): FormattedStepItem {
  const formatted = formatter?.(step, flow.placeholderId) ?? {
    title: step.options?.name ?? step.id ?? '',
    description: typeof step.options?.description === 'string' ? step.options.description : undefined,
  }

  return {
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

function replacePlaceholder(template: string, placeholderId: string, render: () => string): string {
  const token = templatePlaceholderToken(placeholderId)
  return template.includes(token) ? template.replace(token, render()) : template
}

function anchorForHeading(text: string): string {
  return slugify(text)
}

function headingLevelBeforeMarker(
  pageContent: readonly RuntimeDocumentationSection[] | undefined,
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

function flowAnchorBase(flow: AnyDocumentationFlow): string {
  return slugify(formatFlow(flow).placeholderId || flow.placeholderId)
}

function demoAnchorBase(flow: AnyDocumentationFlow, demo: AnyDocumentationDemo): string {
  return slugify(`${flowAnchorBase(flow)}-${formatDemo(demo).placeholderId || demo.placeholderId}`)
}

function anchorForExamplePart(flow: AnyDocumentationFlow, suffix: string): string {
  return `${flowAnchorBase(flow)}-${suffix}`
}

function anchorForDemoPart(flow: AnyDocumentationFlow, demo: AnyDocumentationDemo, suffix: string): string {
  return `${demoAnchorBase(flow, demo)}-${suffix}`
}

function anchorForFlowSection(flow: AnyDocumentationFlow): string {
  return `${flowAnchorBase(flow)}-flow`
}

function firstUsedExampleAnchor(template: string, flow: AnyDocumentationFlow): string | null {
  const candidates: Array<[string, string]> = [
    [flowHtmlPlaceholder(flow.placeholderId), anchorForExamplePart(flow, 'flow-html')],
    [codePlaceholder(flow.placeholderId), anchorForExamplePart(flow, 'code-block')],
    [staticGraphPlaceholder(flow.placeholderId), anchorForExamplePart(flow, 'static-graph')],
    [flowJsonPlaceholder(flow.placeholderId), anchorForExamplePart(flow, 'flow-json')],
  ]

  return candidates.find(([placeholder]) => templateIncludes(template, placeholder))?.[1] ?? null
}

function firstUsedDemoAnchor(
  template: string,
  flow: AnyDocumentationFlow,
  demo: AnyDocumentationDemo
): string | null {
  const candidates: Array<[string, string]> = [
    [
      demoFullTablePlaceholder(flow.placeholderId, demo.placeholderId),
      anchorForDemoPart(flow, demo, 'full-table'),
    ],
    [
      demoResultHtmlPlaceholder(flow.placeholderId, demo.placeholderId),
      anchorForDemoPart(flow, demo, 'result-html'),
    ],
    [
      demoResultMermaidPlaceholder(flow.placeholderId, demo.placeholderId),
      anchorForDemoPart(flow, demo, 'result-mermaid'),
    ],
    [
      demoResultJsonPlaceholder(flow.placeholderId, demo.placeholderId),
      anchorForDemoPart(flow, demo, 'result-json'),
    ],
    [
      demoInitJsonPlaceholder(flow.placeholderId, demo.placeholderId),
      anchorForDemoPart(flow, demo, 'init-json'),
    ],
  ]

  return candidates.find(([placeholder]) => templateIncludes(template, placeholder))?.[1] ?? null
}

function renderTableStepLabel(
  formatter: DocumentationFormatter | undefined,
  flow: AnyDocumentationFlow,
  step: FlowStepInfo
): string {
  const formatted = formatStep(formatter, flow, step)
  const ruleId = isBranchStep(step) ? formatRuleId(step.rawId) : step.id

  return [
    `<div><strong>${escapeHtml(formatted.title)}</strong></div>`,
    ruleId === undefined
      ? ''
      : `<div style="margin-top:2px;color:#475569;font-size:12px;">${escapeHtml(isBranchStep(step) ? `ruleId: ${ruleId}` : ruleId)}</div>`,
    formatted.description == null
      ? ''
      : `<div style="margin-top:4px;color:#334155;font-size:13px;">${escapeHtml(formatted.description)}</div>`,
  ].join('')
}

function hasBranchFlows(step: FlowStepInfo): step is FlowStepInfo & { branches: Record<PropertyKey, FlowLike> } {
  return step.branches != null
}

function getBranchEntries(step: FlowStepInfo): Array<[PropertyKey, FlowLike]> {
  if (!hasBranchFlows(step)) {
    return []
  }

  return getOwnEntries(step.branches)
}

function renderStaticBranchColumns(
  formatter: DocumentationFormatter | undefined,
  flow: AnyDocumentationFlow,
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
  flow: AnyDocumentationFlow,
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
  flow: AnyDocumentationFlow,
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
  flow: AnyDocumentationFlow,
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
  result: Pick<FlowResult, 'status' | 'stepResults'>,
  convertedResult: ConvertedFlowResult,
  failedStepResults: readonly FlattenedFailedStepResult[]
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
        flattenStepResults: failedStepResults,
      }),
    ].join('\n'),
    resultMermaid: renderMermaidBlock(markerId, renderProcessAsMermaidGraph(result)),
    resultHtml: renderResultTable(markerId, convertedResult, failedStepResults),
  }
}

function renderDemoResultSection(
  markerId: string,
  runInput: unknown,
  result: Pick<FlowResult, 'status' | 'stepResults'>,
  convertedResult: ConvertedFlowResult,
  failedStepResults: readonly FlattenedFailedStepResult[]
): string {
  const parts = renderDemoResultParts(markerId, runInput, result, convertedResult, failedStepResults)

  return renderThreeColumnHtml(
    renderMarkdownPane([parts.initJson, '', parts.resultJson].join('\n')),
    renderMarkdownPane(parts.resultMermaid),
    parts.resultHtml
  )
}

type LeafFlowEntry = {
  flow: FlowLike
  referencedBy: AnyDocumentationFlow[]
}

function createNestedFlowExample(
  formatter: DocumentationFormatter | undefined,
  flow: FlowLike
): AnyDocumentationFlow {
  const firstStep = flow.steps[0]

  if (firstStep == null) {
    return {
      placeholderId: 'empty-flow',
      title: 'Empty flow',
      flow,
    }
  }

  const nestedFlowPlaceholderId = firstStep.id ?? firstStep.options?.name ?? 'branch-flow'
  const nestedFlow: AnyDocumentationFlow = {
    placeholderId: nestedFlowPlaceholderId,
    title: nestedFlowPlaceholderId,
    flow,
  }
  const formattedStep = formatStep(formatter, nestedFlow, firstStep)

  return {
    placeholderId: nestedFlowPlaceholderId,
    title: formattedStep.title,
    description: formattedStep.description,
    flow,
  }
}

function collectNestedFlows(flows: readonly AnyDocumentationFlow[]): LeafFlowEntry[] {
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
        for (const [, branchFlow] of getBranchEntries(step)) {
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

          if (!existing.referencedBy.some((entry) => entry.placeholderId === flow.placeholderId)) {
            existing.referencedBy.push(flow)
          }
        }
      }
    }
  }

  return [...nestedFlows.values()]
}

function renderFlowHeading(level: number, formatter: DocumentationFormatter | undefined, flow: AnyDocumentationFlow) {
  const formatted = formatFlow(flow)
  const description = formatted.description == null ? '' : `\n\n${formatted.description}`

  return `${'#'.repeat(level)} ${formatted.title}${description}`
}

function renderReferencedByList(
  formatter: DocumentationFormatter | undefined,
  referencedBy: readonly AnyDocumentationFlow[]
) {
  if (referencedBy.length === 0) {
    return ''
  }

  return ['**Referenced from**', '', ...referencedBy.map((flow) => `- ${formatFlow(flow).title}`)].join('\n')
}

function renderAllFlowsHtmlMermaid(
  formatter: DocumentationFormatter | undefined,
  flows: readonly AnyDocumentationFlow[],
  parentHeadingLevel?: number
): string {
  const flowHeadingLevel = childHeadingLevel(parentHeadingLevel)

  return flows
    .map((flow) => {
      return [
        wrapWithAnchor(anchorForFlowSection(flow), renderFlowHeading(flowHeadingLevel, formatter, flow)),
        '',
        wrapGeneratedBlock(
          replaceKeyToMarkerId(flowHtmlPlaceholder(flow.placeholderId)),
          'html-table',
          renderStaticFlowLayoutTable(formatter, flow, flow.flow.steps)
        ),
        '',
        renderMermaidBlock(
          replaceKeyToMarkerId(staticGraphPlaceholder(flow.placeholderId)),
          renderProcessAsMermaidGraph(flow.flow)
        ),
      ].join('\n')
    })
    .join('\n\n')
}

function renderLeafFlowsHtml(
  formatter: DocumentationFormatter | undefined,
  flows: readonly AnyDocumentationFlow[],
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
        wrapWithAnchor(anchorForFlowSection(leafDoc), renderFlowHeading(leafFlowHeadingLevel, formatter, leafDoc)),
        '',
        referencedBy,
        wrapGeneratedBlock(
          replaceKeyToMarkerId(flowHtmlPlaceholder(leafDoc.placeholderId)),
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
  flows: readonly AnyDocumentationFlow[]
): string[] {
  if (marker === allFlowsHtmlMermaidPlaceholder()) {
    return flows.map((flow) => `- [${formatFlow(flow).title}](#${anchorForFlowSection(flow)})`)
  }

  if (marker === leafFlowsHtmlPlaceholder()) {
    return collectNestedFlows(flows).map((leafFlow) => {
      const leafDoc = createNestedFlowExample(formatter, leafFlow.flow)
      return `- [${formatFlow(leafDoc).title}](#${anchorForFlowSection(leafDoc)})`
    })
  }

  const flow = flows.find(
    (entry) => entry.placeholderId === marker.replace(/_(CODE_BLOCK|FLOW_JSON|STATIC_GRAPH|FLOW_HTML)$/, '')
  )
  if (flow != null) {
    const flowAnchor = firstUsedExampleAnchor(template, flow) ?? anchorForFlowSection(flow)
    return [`- [${formatFlow(flow).title}](#${flowAnchor})`]
  }

  for (const flowEntry of flows) {
    for (const demo of flowEntry.demos ?? []) {
      const demoMarkers = [
        demoFullTablePlaceholder(flowEntry.placeholderId, demo.placeholderId),
        demoInitJsonPlaceholder(flowEntry.placeholderId, demo.placeholderId),
        demoResultJsonPlaceholder(flowEntry.placeholderId, demo.placeholderId),
        demoResultMermaidPlaceholder(flowEntry.placeholderId, demo.placeholderId),
        demoResultHtmlPlaceholder(flowEntry.placeholderId, demo.placeholderId),
      ]

      if (demoMarkers.includes(marker)) {
        const demoAnchor = firstUsedDemoAnchor(template, flowEntry, demo)
        if (demoAnchor == null) {
          return []
        }

        return [`- [${formatDemo(demo).title}](#${demoAnchor})`]
      }
    }
  }

  return []
}

function renderStructuredToc(
  template: string,
  formatter: DocumentationFormatter | undefined,
  flows: readonly AnyDocumentationFlow[],
  pageContent: readonly RuntimeDocumentationSection[]
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

function renderToc(
  template: string,
  formatter: DocumentationFormatter | undefined,
  flows: readonly AnyDocumentationFlow[],
  pageContent?: readonly RuntimeDocumentationSection[]
) {
  if (pageContent != null) {
    return renderStructuredToc(template, formatter, flows, pageContent)
  }

  const lines: string[] = []
  const rootFlowSectionIncluded = templateIncludes(template, allFlowsHtmlMermaidPlaceholder())
  const leafFlowSectionIncluded = templateIncludes(template, leafFlowsHtmlPlaceholder())

  for (const flow of flows) {
    const flowInfo = formatFlow(flow)
    const exampleAnchor = rootFlowSectionIncluded ? anchorForFlowSection(flow) : firstUsedExampleAnchor(template, flow)

    if (exampleAnchor == null && (flow.demos?.length ?? 0) === 0) {
      continue
    }

    lines.push(exampleAnchor == null ? `- ${flowInfo.title}` : `- [${flowInfo.title}](#${exampleAnchor})`)

    for (const demo of flow.demos ?? []) {
      const demoInfo = formatDemo(demo)
      const demoAnchor = firstUsedDemoAnchor(template, flow, demo)
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
      lines.push(`- [${leafInfo.title}](#${anchorForFlowSection(leafDoc)})`)
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
  sourceFiles: SourceFiles,
  flows: readonly AnyDocumentationFlow[]
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
    const flowSourceFiles = sourceFileList(flow.sourceFiles ?? sourceFiles)
    const flowMarkers: MarkerReportEntry[] = [
      {
        marker: templatePlaceholderToken(codePlaceholder(flow.placeholderId)),
        used: templateIncludes(template, codePlaceholder(flow.placeholderId)),
      },
      {
        marker: templatePlaceholderToken(flowHtmlPlaceholder(flow.placeholderId)),
        used: templateIncludes(template, flowHtmlPlaceholder(flow.placeholderId)),
      },
      {
        marker: templatePlaceholderToken(staticGraphPlaceholder(flow.placeholderId)),
        used: templateIncludes(template, staticGraphPlaceholder(flow.placeholderId)),
      },
      {
        marker: templatePlaceholderToken(flowJsonPlaceholder(flow.placeholderId)),
        used: templateIncludes(template, flowJsonPlaceholder(flow.placeholderId)),
      },
    ]

    console.log(`${flow.placeholderId}:`)
    console.log(
      `- source code in ${flowSourceFiles.join(', ')}: ${sourceMarker(flow.placeholderId, 'START')} / ${sourceMarker(flow.placeholderId, 'END')}`
    )
    console.log(`- output in ${templateFile}:`)
    console.log('  - flow markers:')
    for (const entry of flowMarkers) {
      console.log(`    - ${formatUsage(entry.marker, entry.used)}`)
    }
    console.log('  - demos:')
    for (const demo of flow.demos ?? []) {
      const demoName = demoBase(flow.placeholderId, demo.placeholderId)
      const demoMarkers: MarkerReportEntry[] = [
        {
          marker: templatePlaceholderToken(demoFullTablePlaceholder(flow.placeholderId, demo.placeholderId)),
          used: templateIncludes(template, demoFullTablePlaceholder(flow.placeholderId, demo.placeholderId)),
        },
        {
          marker: templatePlaceholderToken(demoInitJsonPlaceholder(flow.placeholderId, demo.placeholderId)),
          used: templateIncludes(template, demoInitJsonPlaceholder(flow.placeholderId, demo.placeholderId)),
        },
        {
          marker: templatePlaceholderToken(demoResultJsonPlaceholder(flow.placeholderId, demo.placeholderId)),
          used: templateIncludes(template, demoResultJsonPlaceholder(flow.placeholderId, demo.placeholderId)),
        },
        {
          marker: templatePlaceholderToken(demoResultMermaidPlaceholder(flow.placeholderId, demo.placeholderId)),
          used: templateIncludes(template, demoResultMermaidPlaceholder(flow.placeholderId, demo.placeholderId)),
        },
        {
          marker: templatePlaceholderToken(demoResultHtmlPlaceholder(flow.placeholderId, demo.placeholderId)),
          used: templateIncludes(template, demoResultHtmlPlaceholder(flow.placeholderId, demo.placeholderId)),
        },
      ]

      console.log(`    - ${demoName}`)
      for (const entry of demoMarkers) {
        console.log(`      - ${formatUsage(entry.marker, entry.used)}`)
      }
    }
  }
}

function renderGeneratedExample(
  markdown: string,
  sourceFiles: SourceFiles,
  formatter: DocumentationFormatter | undefined,
  flow: AnyDocumentationFlow,
  demoRenders: readonly DemoRender[]
): string {
  let nextMarkdown = markdown

  nextMarkdown = replacePlaceholder(nextMarkdown, codePlaceholder(flow.placeholderId), () =>
    wrapWithAnchor(
      anchorForExamplePart(flow, 'code-block'),
      [
        '```ts',
        readCodeBlockFromSources(flow.sourceFiles ?? sourceFiles, flow.placeholderId).replaceAll('```', '\\`\\`\\`'),
        '```',
      ].join('\n')
    )
  )
  nextMarkdown = replacePlaceholder(nextMarkdown, flowJsonPlaceholder(flow.placeholderId), () =>
    wrapWithAnchor(
      anchorForExamplePart(flow, 'flow-json'),
      renderJsonCodeBlock(
        replaceKeyToMarkerId(flowJsonPlaceholder(flow.placeholderId)),
        serializeForJson(flow.flow)
      )
    )
  )
  nextMarkdown = replacePlaceholder(nextMarkdown, staticGraphPlaceholder(flow.placeholderId), () =>
    wrapWithAnchor(
      anchorForExamplePart(flow, 'static-graph'),
      renderTwoColumnHtml(
        renderMarkdownPane(
          renderMermaidBlock(
            replaceKeyToMarkerId(staticGraphPlaceholder(flow.placeholderId)),
            renderProcessAsMermaidGraph(flow.flow)
          )
        ),
        renderStaticFlowLayoutTable(formatter, flow, flow.flow.steps)
      )
    )
  )
  nextMarkdown = replacePlaceholder(nextMarkdown, flowHtmlPlaceholder(flow.placeholderId), () =>
    renderStaticFlowHtmlBlock(
      replaceKeyToMarkerId(flowHtmlPlaceholder(flow.placeholderId)),
      anchorForExamplePart(flow, 'flow-html'),
      formatter,
      flow,
      flow.flow.steps
    )
  )

  for (const rendered of demoRenders) {
    const markerId = replaceKeyToMarkerId(demoBase(flow.placeholderId, rendered.demo.placeholderId))
    const runInput =
      rendered.demo.ctx === undefined ? rendered.demo.data : { data: rendered.demo.data, ctx: rendered.demo.ctx }
    const parts = renderDemoResultParts(
      markerId,
      runInput,
      rendered.result,
      rendered.convertedResult,
      rendered.failedStepResults
    )

    nextMarkdown = replacePlaceholder(
      nextMarkdown,
      demoFullTablePlaceholder(flow.placeholderId, rendered.demo.placeholderId),
      () =>
        wrapWithAnchor(
          anchorForDemoPart(flow, rendered.demo, 'full-table'),
          renderDemoResultSection(
            markerId,
            runInput,
            rendered.result,
            rendered.convertedResult,
            rendered.failedStepResults
          )
        )
    )
    nextMarkdown = replacePlaceholder(
      nextMarkdown,
      demoInitJsonPlaceholder(flow.placeholderId, rendered.demo.placeholderId),
      () => wrapWithAnchor(anchorForDemoPart(flow, rendered.demo, 'init-json'), parts.initJson)
    )
    nextMarkdown = replacePlaceholder(
      nextMarkdown,
      demoResultJsonPlaceholder(flow.placeholderId, rendered.demo.placeholderId),
      () => wrapWithAnchor(anchorForDemoPart(flow, rendered.demo, 'result-json'), parts.resultJson)
    )
    nextMarkdown = replacePlaceholder(
      nextMarkdown,
      demoResultMermaidPlaceholder(flow.placeholderId, rendered.demo.placeholderId),
      () => wrapWithAnchor(anchorForDemoPart(flow, rendered.demo, 'result-mermaid'), parts.resultMermaid)
    )
    nextMarkdown = replacePlaceholder(
      nextMarkdown,
      demoResultHtmlPlaceholder(flow.placeholderId, rendered.demo.placeholderId),
      () => wrapWithAnchor(anchorForDemoPart(flow, rendered.demo, 'result-html'), parts.resultHtml)
    )
  }

  return nextMarkdown
}

async function renderAllDemoRenders(
  flows: readonly AnyDocumentationFlow[]
): Promise<ReadonlyMap<string, readonly DemoRender[]>> {
  return new Map(
    await Promise.all(
      flows.map(async (flow) => {
        const demoRenders = await Promise.all(
          (flow.demos ?? []).map(async (demo) => {
            const result =
              demo.ctx === undefined ? await flow.flow.run(demo.data) : await flow.flow.run(demo.data, demo.ctx)
            const failedStepResults = flattenStepResults(result.stepResults)
            return {
              demo,
              result,
              convertedResult: convertResultNode(result) as ConvertedFlowResult,
              failedStepResults,
            } satisfies DemoRender
          })
        )

        return [flow.placeholderId, demoRenders] as const
      })
    )
  )
}

export async function renderMarkdownDocumentation<const TFlows extends readonly AnyDocumentationFlow[]>({
  template,
  sourceFiles,
  formatter,
  flows = [] as unknown as TFlows & TypeCheckedDocumentationFlows<TFlows>,
  pageContent,
}: RenderMarkdownDocumentationOptions<TFlows>): Promise<string> {
  let markdown = template
  const demoRendersByFlowPlaceholderId = await renderAllDemoRenders(flows)

  markdown = replacePlaceholder(markdown, tocPlaceholder(), () => renderToc(template, formatter, flows, pageContent))
  markdown = replacePlaceholder(markdown, allFlowsHtmlMermaidPlaceholder(), () =>
    renderAllFlowsHtmlMermaid(formatter, flows, headingLevelBeforeMarker(pageContent, allFlowsHtmlMermaidPlaceholder()))
  )
  markdown = replacePlaceholder(markdown, leafFlowsHtmlPlaceholder(), () =>
    renderLeafFlowsHtml(formatter, flows, headingLevelBeforeMarker(pageContent, leafFlowsHtmlPlaceholder()))
  )

  for (const flow of flows) {
    markdown = renderGeneratedExample(
      markdown,
      sourceFiles,
      formatter,
      flow,
      demoRendersByFlowPlaceholderId.get(flow.placeholderId) ?? []
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
  sourceFiles,
  outputFile,
  printReport = false,
  ...renderOptions
}: WriteMarkdownDocumentationOptions<TFlows>): Promise<void> {
  validateFlowMetadata(renderOptions.flows ?? [])

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
      sourceFiles,
      renderOptions.flows ?? []
    )
  }

  writeFileSync(
    outputFile,
    await renderMarkdownDocumentation({
      template,
      sourceFiles,
      flows: renderOptions.flows,
      formatter: renderOptions.formatter,
      pageContent: 'pageContent' in renderOptions ? renderOptions.pageContent : undefined,
    })
  )
}
