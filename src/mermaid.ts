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
  const branchKeys = stepResult?.branches?.map((branch) => String(branch.key))
  const isBranchStep = step.description === 'Branch'

  if (branchKeys != null && branchKeys.length > 0) {
    return `${step.id}:\nbranches: ${branchKeys.join(', ')}`
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
  nextNodeId: string,
  stepResult: MermaidStepResult,
  stepIndex: number
): string[] {
  if (stepResult.branches == null || stepResult.branches.length === 0) {
    return [`  ${parentNodeId} --> ${nextNodeId}`]
  }

  const lines: string[] = []
  const branchResultNodeId = `branch_${stepIndex}_result`
  lines.push(`  ${branchResultNodeId}["${escapeMermaidLabel(`${stepResult.id}:\nResult: ${stepResult.result}`)}"]`)
  lines.push(`  class ${branchResultNodeId} ${statusToClassName(stepResult.result)}`)

  for (const [branchIndex, branch] of stepResult.branches.entries()) {
    const branchPrefix = `branch_${stepIndex}_${branchIndex}`
    const branchStartNodeId = `${branchPrefix}_start`
    const branchResultById = new Map(branch.stepResults.map((childStepResult) => [childStepResult.id, childStepResult]))

    lines.push(`  ${branchStartNodeId}([Branch: ${escapeMermaidLabel(String(branch.key))}])`)
    lines.push(`  ${parentNodeId} --> ${branchStartNodeId}`)

    if (branch.steps.length === 0) {
      lines.push(`  ${branchStartNodeId} --> ${branchResultNodeId}`)
    } else {
      for (const [childStepIndex, childStep] of branch.steps.entries()) {
        const childNodeId = `${branchPrefix}_step_${childStepIndex}`
        const childStepResult = branchResultById.get(childStep.id)
        const childLabel = renderStepLabel(childStep, childStepResult)
        const previousNodeId = childStepIndex === 0 ? branchStartNodeId : `${branchPrefix}_step_${childStepIndex - 1}`
        const targetNodeId =
          childStepIndex === branch.steps.length - 1 ? branchResultNodeId : `${branchPrefix}_step_${childStepIndex + 1}`

        lines.push(`  ${childNodeId}["${escapeMermaidLabel(childLabel)}"]`)
        lines.push(`  ${previousNodeId} --> ${childNodeId}`)
        lines.push(`  ${childNodeId} --> ${targetNodeId}`)

        if (childStepResult != null) {
          lines.push(`  class ${childNodeId} ${statusToClassName(childStepResult.result)}`)
        }
      }
    }

    lines.push(`  class ${branchStartNodeId} executed`)
  }

  lines.push(`  ${branchResultNodeId} --> ${nextNodeId}`)

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
      lines.push(...renderBranchGraphLines(nodeId, nextNodeId, stepResult, index))
    }
  }

  lines.push(`  done([${doneLabel}])`)
  lines.push('  start --> step_0')
  lines.push('  classDef executed fill:#e8f1ff,stroke:#1d4ed8,stroke-width:2px')
  lines.push('  classDef success fill:#ecfdf5,stroke:#16a34a,stroke-width:2px')
  lines.push('  classDef complete fill:#f0fdf4,stroke:#15803d,stroke-width:2px')
  lines.push('  classDef failure fill:#fef2f2,stroke:#dc2626,stroke-width:2px')
  lines.push('  classDef neutral fill:#f8fafc,stroke:#94a3b8,stroke-dasharray: 4 2')

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
