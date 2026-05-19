import type { FlowLike, FlowStepDefinition, FlowStepResult, StepStatus } from './structuredFlow'
import { FlowResult } from './structuredFlow'

type MermaidRenderable =
  | Pick<FlowLike<any, any, any>, 'steps'>
  | Pick<FlowResult<any, any>, 'steps' | 'ok' | 'stepResults'>

function hasStepResults(value: MermaidRenderable): value is Pick<FlowResult<any, any>, 'steps' | 'ok' | 'stepResults'> {
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

function statusToClassName(result: StepStatus): string {
  return result === 'ok' ? 'success' : result === 'skip' ? 'neutral' : result === 'stop' ? 'complete' : 'failure'
}

function renderStepLabel(step: FlowStepDefinition<unknown>, stepResult?: FlowStepResult): string {
  const branchKeys = stepResult?.branches
    ?.filter((branch) => branch.result !== 'skip')
    .map((branch) => String(branch.key))
  const description = formatMermaidValue(step.description)

  if (stepResult != null && branchKeys != null && branchKeys.length > 0) {
    return `${step.id}: ${description}\nbranches: ${branchKeys.join(', ')}\n[${stepResult.result}]${
      stepResult.info == null ? '' : `\n${String(stepResult.info)}`
    }`
  }

  if (stepResult?.branches != null) {
    return `${step.id}: ${description}\n[${stepResult.result}]${stepResult.info == null ? '' : `\n${String(stepResult.info)}`}`
  }

  if (stepResult == null) {
    return `${step.id}: ${description}`
  }

  return `${step.id}: ${description}\n[${stepResult.result}]${stepResult.info == null ? '' : `\n${String(stepResult.info)}`}`
}

function renderBranchGraphLines(
  parentNodeId: string,
  nextNodeId: string | undefined,
  stepResult: FlowStepResult,
  branchPrefix: string
): string[] {
  if (stepResult.branches == null || stepResult.branches.length === 0) {
    return nextNodeId == null ? [] : [`  ${parentNodeId} --> ${nextNodeId}`]
  }

  const lines: string[] = []
  const branchEndNodeId = nextNodeId == null ? undefined : `${branchPrefix}_end`

  if (branchEndNodeId != null) {
    lines.push(`  ${branchEndNodeId}["${escapeMermaidLabel(`${stepResult.id}:\nend`)}"]`)
    lines.push(`  ${branchEndNodeId} --> ${nextNodeId}`)
    lines.push(`  class ${branchEndNodeId} join`)
  }

  for (const [branchIndex, branch] of stepResult.branches.entries()) {
    const branchNodePrefix = `${branchPrefix}_${branchIndex}`
    const branchStartNodeId = `${branchNodePrefix}_start`
    const branchResultById = new Map(branch.stepResults.map((childStepResult) => [childStepResult.id, childStepResult]))
    const branchStartLabel =
      branch.result === 'skip' ? `Branch: ${String(branch.key)}\n[skip]` : `Branch: ${String(branch.key)}`

    lines.push(`  ${branchStartNodeId}["${escapeMermaidLabel(branchStartLabel)}"]`)
    lines.push(`  ${parentNodeId} --> ${branchStartNodeId}`)

    if (branch.steps.length > 0) {
      for (const [childStepIndex, childStep] of branch.steps.entries()) {
        const childNodeId = `${branchNodePrefix}_step_${childStepIndex}`
        const childStepResult = branchResultById.get(childStep.id)
        const childLabel = renderStepLabel(childStep, childStepResult)
        const previousNodeId =
          childStepIndex === 0 ? branchStartNodeId : `${branchNodePrefix}_step_${childStepIndex - 1}`
        const targetNodeId =
          childStepIndex === branch.steps.length - 1
            ? branchEndNodeId
            : `${branchNodePrefix}_step_${childStepIndex + 1}`

        lines.push(`  ${childNodeId}["${escapeMermaidLabel(childLabel)}"]`)
        lines.push(`  ${previousNodeId} --> ${childNodeId}`)

        if (childStepResult != null) {
          lines.push(...renderBranchGraphLines(childNodeId, targetNodeId, childStepResult, `${childNodeId}_branch`))
          lines.push(`  class ${childNodeId} ${statusToClassName(childStepResult.result)}`)
        } else {
          lines.push(`  ${childNodeId} --> ${targetNodeId}`)
        }
      }
    } else if (branchEndNodeId != null) {
      lines.push(`  ${branchStartNodeId} --> ${branchEndNodeId}`)
    }

    lines.push(`  class ${branchStartNodeId} ${branch.result === 'skip' ? 'neutral' : 'executed'}`)
  }

  return lines
}

export function renderProcessAsMermaidGraph(value: MermaidRenderable): string {
  const steps = value.steps as readonly FlowStepDefinition<unknown>[]
  const sequenceResult = hasStepResults(value) ? value : undefined
  const lines = ['flowchart TD', '  start([Start])']
  const resultById = new Map(
    sequenceResult?.stepResults.map((stepResult) => [stepResult.id, stepResult as FlowStepResult])
  )
  let finalResult: FlowStepResult | undefined
  if (sequenceResult != null) {
    for (let index = sequenceResult.stepResults.length - 1; index >= 0; index--) {
      const stepResult = sequenceResult.stepResults[index] as FlowStepResult
      if (stepResult.result !== 'skip') {
        finalResult = stepResult
        break
      }
    }
  }
  const doneLabel =
    sequenceResult == null || finalResult == null
      ? 'Done'
      : finalResult.result === 'exception'
        ? 'Stopped by Exception'
        : finalResult.result === 'stop'
          ? 'Completed Early'
          : !sequenceResult.ok
            ? 'Completed with Errors'
            : 'Done'

  if (steps.length === 0) {
    lines.push(`  done([${doneLabel}])`)
    lines.push('  start --> done')
    lines.push('  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px')
    lines.push('  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px')
    lines.push('  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px')
    lines.push('  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px')
    lines.push('  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2')
    return lines.join('\n')
  }

  for (const [index, step] of steps.entries()) {
    const nodeId = `step_${index}`
    const stepResult = resultById.get(step.id)
    const label = renderStepLabel(step, stepResult)
    const nextNodeId = index === steps.length - 1 ? 'done' : `step_${index + 1}`

    lines.push(`  ${nodeId}["${escapeMermaidLabel(label)}"]`)

    if (stepResult == null) {
      lines.push(`  ${nodeId} --> ${nextNodeId}`)
    } else {
      lines.push(...renderBranchGraphLines(nodeId, nextNodeId, stepResult, `branch_${index}`))
    }
  }

  lines.push(`  done([${doneLabel}])`)
  lines.push('  start --> step_0')
  lines.push('  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px')
  lines.push('  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px')
  lines.push('  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px')
  lines.push('  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px')
  lines.push('  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2')
  lines.push('  classDef join fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,color:#475569')

  if (sequenceResult != null) {
    for (const [index, step] of steps.entries()) {
      const stepResult = resultById.get(step.id)
      if (stepResult == null) {
        continue
      }

      const nodeId = `step_${index}`
      lines.push(`  class ${nodeId} ${statusToClassName(stepResult.result)}`)
    }

    const terminalClass = sequenceResult.ok ? 'success' : 'failure'
    lines.push('  class start executed')
    lines.push(`  class done ${terminalClass}`)
  }

  return lines.join('\n')
}
