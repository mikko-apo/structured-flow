import { AsyncFlow, AsyncFlowBuilder, Flow, FlowBuilder, FlowResult, StepStatus } from './structuredFlow'

type MermaidStep = {
  id: string
  description: string
}

type MermaidStepResult = {
  id: string
  result: StepStatus
  info?: unknown
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
    const label =
      stepResult == null
        ? `${step.id}: ${step.description}`
        : `${step.id}: ${step.description}\n[${stepResult.result}]${stepResult.info == null ? '' : `\n${String(stepResult.info)}`}`
    const nextNodeId = index === steps.length - 1 ? 'done' : `step_${index + 1}`

    lines.push(`  ${nodeId}["${escapeMermaidLabel(label)}"]`)
    lines.push(`  ${nodeId} --> ${nextNodeId}`)
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
      const className =
        stepResult.result === 'ok'
          ? 'success'
          : stepResult.result === 'skip'
            ? 'neutral'
            : stepResult.result === 'stop'
              ? 'complete'
              : 'failure'

      lines.push(`  class ${nodeId} ${className}`)
    }

    const terminalClass = sequenceResult.ok ? 'success' : 'failure'
    lines.push('  class start executed')
    lines.push(`  class done ${terminalClass}`)
  }

  return lines.join('\n')
}
