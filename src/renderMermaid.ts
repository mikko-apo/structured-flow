import { getOwnEntries, getRuleId } from './utils.ts'
import { type FlowResult, type StepResult, type StepStatus } from './flowClasses.ts'

type MermaidStepResult = StepResult
type MermaidFlowLike = {
  steps: readonly MermaidFlowStepInfo[]
}
type MermaidFlowStepInfo = {
  id?: string
  rawId?: unknown
  options?: {
    name?: string
    description?: string
  }
  branches?: Record<PropertyKey, MermaidFlowLike>
}
type MermaidRenderable = MermaidFlowLike | Pick<FlowResult, 'status' | 'stepResults'>

type RenderableBranch = {
  key: PropertyKey
  status?: StepStatus
  steps: readonly MermaidFlowStepInfo[]
  stepResults?: readonly MermaidStepResult[]
}

const mermaidClassDefinitions = [
  '  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px',
  '  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px',
  '  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px',
  '  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px',
  '  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2',
]

function hasStepResults(value: MermaidRenderable): value is Pick<FlowResult, 'status' | 'stepResults'> {
  return 'stepResults' in value
}

function escapeMermaidLabel(value: string): string {
  return value.replaceAll('"', '\\"')
}

function formatMermaidValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => formatMermaidValue(entry)).join(', ')
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${key}=${formatMermaidValue(entry)}`)
      .join(', ')
  }

  return String(value)
}

function statusToClassName(status: StepStatus): string {
  return status === 'ok' ? 'success' : status === 'skip' ? 'neutral' : status === 'stop' ? 'complete' : 'failure'
}

function getStepDescription(step: MermaidFlowStepInfo): string {
  return typeof step.options?.description === 'string' ? step.options.description : ''
}

function getStepTitle(step: MermaidFlowStepInfo): string {
  return typeof step.options?.name === 'string' ? step.options.name : (step.id ?? '')
}

function getBranchEntries(step: MermaidFlowStepInfo): Array<[PropertyKey, MermaidFlowLike]> {
  if (step.branches == null) {
    return []
  }

  return getOwnEntries(step.branches)
}

function getRenderableBranches(step: MermaidFlowStepInfo, stepResult?: MermaidStepResult): RenderableBranch[] {
  if (stepResult?.branches != null) {
    return stepResult.branches.map((branch) => ({
      key: branch.key,
      status: branch.status,
      steps: branch.stepResults.map((childStepResult) => childStepResult.stepInfo),
      stepResults: branch.stepResults,
    }))
  }

  return getBranchEntries(step).map(([key, flow]) => ({
    key,
    steps: flow.steps,
  }))
}

function renderStepPayload(stepResult: MermaidStepResult): string {
  if (stepResult.variables == null || Object.keys(stepResult.variables).length === 0) {
    return ''
  }

  if (Object.keys(stepResult.variables).length === 1 && 'info' in stepResult.variables) {
    return String(stepResult.variables.info)
  }

  return formatMermaidValue(stepResult.variables)
}

function renderStepLabel(step: MermaidFlowStepInfo, stepResult?: MermaidStepResult): string {
  const selectedBranchKeys =
    stepResult?.selectedBranchKeys?.map((branchKey) => String(branchKey)) ??
    stepResult?.branches?.filter((branch) => branch.status !== 'skip').map((branch) => String(branch.key))
  const staticBranchKeys = getBranchEntries(step).map(([key]) => String(key))
  const description = getStepDescription(step)
  const payload = stepResult == null ? '' : renderStepPayload(stepResult)
  const stepTitle = getStepTitle(step)
  const ruleId = step.branches == null ? undefined : getRuleId(step.rawId)
  const title =
    description === ''
      ? `${stepTitle}${ruleId === undefined ? '' : `\nruleId: ${ruleId}`}`
      : `${stepTitle}: ${description}${ruleId === undefined ? '' : `\nruleId: ${ruleId}`}`

  if (stepResult != null && selectedBranchKeys != null && selectedBranchKeys.length > 0) {
    return `${title}\nbranches: ${selectedBranchKeys.join(', ')}\n[${stepResult.status}]${payload === '' ? '' : `\n${payload}`}`
  }

  if (stepResult?.branches != null) {
    return `${title}\n[${stepResult.status}]${payload === '' ? '' : `\n${payload}`}`
  }

  if (stepResult == null && staticBranchKeys.length > 0) {
    return `${title}\nbranches: ${staticBranchKeys.join(', ')}`
  }

  if (stepResult == null) {
    return title
  }

  return `${title}\n[${stepResult.status}]${payload === '' ? '' : `\n${payload}`}`
}

function renderBranchGraphLines(
  parentNodeId: string,
  nextNodeId: string | undefined,
  step: MermaidFlowStepInfo,
  stepResult: MermaidStepResult | undefined,
  branchPrefix: string
): string[] {
  const branches = getRenderableBranches(step, stepResult)

  if (branches.length === 0) {
    return nextNodeId == null ? [] : [`  ${parentNodeId} --> ${nextNodeId}`]
  }

  const lines: string[] = []
  const branchEndNodeId = nextNodeId == null ? undefined : `${branchPrefix}_end`

  if (branchEndNodeId != null) {
    lines.push(`  ${branchEndNodeId}["${escapeMermaidLabel(`${getStepTitle(step)}:\nend`)}"]`)
    lines.push(`  ${branchEndNodeId} --> ${nextNodeId}`)
    lines.push(`  class ${branchEndNodeId} join`)
  }

  for (const [branchIndex, branch] of branches.entries()) {
    const branchNodePrefix = `${branchPrefix}_${branchIndex}`
    const branchStartNodeId = `${branchNodePrefix}_start`
    const branchStartLabel =
      branch.status === 'skip' ? `Branch: ${String(branch.key)}\n[skip]` : `Branch: ${String(branch.key)}`

    lines.push(`  ${branchStartNodeId}["${escapeMermaidLabel(branchStartLabel)}"]`)
    lines.push(`  ${parentNodeId} --> ${branchStartNodeId}`)

    if (branch.steps.length > 0) {
      for (const [childStepIndex, childStep] of branch.steps.entries()) {
        const childNodeId = `${branchNodePrefix}_step_${childStepIndex}`
        const childStepResult = branch.stepResults?.[childStepIndex]
        const childLabel = renderStepLabel(childStep, childStepResult)
        const previousNodeId =
          childStepIndex === 0 ? branchStartNodeId : `${branchNodePrefix}_step_${childStepIndex - 1}`
        const targetNodeId =
          childStepIndex === branch.steps.length - 1
            ? branchEndNodeId
            : `${branchNodePrefix}_step_${childStepIndex + 1}`

        lines.push(`  ${childNodeId}["${escapeMermaidLabel(childLabel)}"]`)

        if (childStepIndex === 0) {
          lines.push(`  ${previousNodeId} --> ${childNodeId}`)
        }

        lines.push(
          ...renderBranchGraphLines(childNodeId, targetNodeId, childStep, childStepResult, `${childNodeId}_branch`)
        )

        if (childStepResult != null) {
          lines.push(`  class ${childNodeId} ${statusToClassName(childStepResult.status)}`)
        }
      }
    } else if (branchEndNodeId != null) {
      lines.push(`  ${branchStartNodeId} --> ${branchEndNodeId}`)
    }

    lines.push(`  class ${branchStartNodeId} ${branch.status === 'skip' ? 'neutral' : 'executed'}`)
  }

  return lines
}

function renderDoneLabel(status: StepStatus): string {
  if (status === 'exception') {
    return 'Stopped by Exception'
  }

  if (status === 'stop') {
    return 'Completed Early'
  }

  if (status === 'fail') {
    return 'Completed with Failures'
  }

  return 'Done'
}

export function renderProcessAsMermaidGraph(value: MermaidRenderable): string {
  const sequenceResult = hasStepResults(value) ? value : undefined
  const steps = hasStepResults(value) ? value.stepResults.map((stepResult) => stepResult.stepInfo) : value.steps
  const lines = ['flowchart TD', '  start([Start])']
  const doneLabel = sequenceResult == null ? 'Done' : renderDoneLabel(sequenceResult.status)

  if (steps.length === 0) {
    lines.push(`  done([${doneLabel}])`)
    lines.push('  start --> done')
    lines.push(...mermaidClassDefinitions)
    return lines.join('\n')
  }

  for (const [index, step] of steps.entries()) {
    const nodeId = `step_${index}`
    const stepResult = sequenceResult?.stepResults[index]
    const label = renderStepLabel(step, stepResult)
    const nextNodeId = index === steps.length - 1 ? 'done' : `step_${index + 1}`

    lines.push(`  ${nodeId}["${escapeMermaidLabel(label)}"]`)
    lines.push(...renderBranchGraphLines(nodeId, nextNodeId, step, stepResult, `branch_${index}`))
  }

  lines.push(`  done([${doneLabel}])`)
  lines.push('  start --> step_0')
  lines.push(...mermaidClassDefinitions)
  lines.push('  classDef join fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,color:#475569')

  if (sequenceResult != null) {
    for (const [index] of steps.entries()) {
      const stepResult = sequenceResult.stepResults[index]
      if (stepResult == null) {
        continue
      }

      const nodeId = `step_${index}`
      lines.push(`  class ${nodeId} ${statusToClassName(stepResult.status)}`)
    }

    const terminalClass = statusToClassName(sequenceResult.status)
    lines.push('  class start executed')
    lines.push(`  class done ${terminalClass}`)
  }

  return lines.join('\n')
}
