import {
  AsyncFlow,
  AsyncFlowBuilder,
  BranchRunResult,
  Flow,
  FlowBuilder,
  FlowResult,
  StepStatus,
} from './structuredFlow'

type MermaidStep = {
  id: string
  description: string
}

type MermaidStepResult = {
  id: string
  result: StepStatus
  info?: unknown
  branches?: BranchRunResult[]
}

type MermaidRenderable =
  | Pick<FlowBuilder<any, any, any, any>, 'steps'>
  | Pick<AsyncFlowBuilder<any, any, any, any>, 'steps'>
  | Pick<Flow<any, any, any>, 'steps'>
  | Pick<AsyncFlow<any, any, any>, 'steps'>
  | Pick<FlowResult<any, any>, 'steps' | 'ok' | 'stepResults'>

function hasStepResults(value: MermaidRenderable): value is Pick<FlowResult<any, any>, 'steps' | 'ok' | 'stepResults'> {
  return 'stepResults' in value
}

function escapeMermaidLabel(value: string): string {
  return value.replaceAll('"', '\\"')
}

function statusToClassName(result: StepStatus): string {
  return result === 'ok' ? 'success' : result === 'skip' ? 'neutral' : result === 'stop' ? 'complete' : 'failure'
}

function renderStepLabel(step: MermaidStep, stepResult?: MermaidStepResult): string {
  const branchKeys = stepResult?.branches?.filter((branch) => branch.result !== 'skip').map((branch) => String(branch.key))
  const isBranchStep = step.description === 'Branch'

  if (stepResult != null && branchKeys != null && branchKeys.length > 0) {
    return `${step.id}:\nbranches: ${branchKeys.join(', ')}\n[${stepResult.result}]${
      stepResult.info == null ? '' : `\n${String(stepResult.info)}`
    }`
  }

  if (isBranchStep && stepResult != null) {
    return `${step.id}: branch()\n[${stepResult.result}]${stepResult.info == null ? '' : `\n${String(stepResult.info)}`}`
  }

  if (isBranchStep) {
    return `${step.id}: branch()`
  }

  if (stepResult == null) {
    return `${step.id}: ${step.description}`
  }

  return `${step.id}: ${step.description}\n[${stepResult.result}]${stepResult.info == null ? '' : `\n${String(stepResult.info)}`}`
}

function renderBranchGraphLines(
  parentNodeId: string,
  nextNodeId: string | undefined,
  stepResult: MermaidStepResult,
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
        const previousNodeId = childStepIndex === 0 ? branchStartNodeId : `${branchNodePrefix}_step_${childStepIndex - 1}`
        const targetNodeId =
          childStepIndex === branch.steps.length - 1 ? branchEndNodeId : `${branchNodePrefix}_step_${childStepIndex + 1}`

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
  const steps = value.steps as readonly MermaidStep[]
  const sequenceResult = hasStepResults(value) ? value : undefined
  const lines = ['flowchart TD', '  start([Start])']
  const resultById = new Map(
    sequenceResult?.stepResults.map((stepResult) => [stepResult.id, stepResult as MermaidStepResult])
  )
  let finalResult: MermaidStepResult | undefined
  if (sequenceResult != null) {
    for (let index = sequenceResult.stepResults.length - 1; index >= 0; index--) {
      const stepResult = sequenceResult.stepResults[index] as MermaidStepResult
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
