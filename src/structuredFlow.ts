import {
  type BranchOptions,
  type FlowOptions,
  Rule,
  RuleId,
  StepFnResult,
  type StepFnResultOptions,
  type StepStatus,
} from './flowClasses.ts'
import { Flow, type CreateFlowFactory } from './flow.ts'

type RuleAsyncFlag<Fn extends (...args: any[]) => any> = ReturnType<Fn> extends Promise<any> ? true : false

function stepFnResult(status: StepStatus, params?: StepFnResultOptions): StepFnResult {
  return new StepFnResult(status, params)
}

export function ok(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('ok', params)
}

export function skip(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('skip', params)
}

export function stop(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('stop', params)
}

export function fail(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('fail', params)
}

export function exception(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('exception', params)
}

export function ruleId<I = undefined>(id: string, params: { description?: string; info?: I } = {}): RuleId<I> {
  return new RuleId(id, params.description, params.info)
}

export function rule<I, Fn extends (...args: any[]) => any>(
  id: string,
  stepFn: Fn,
  params?: { path?: string; description?: string; info?: I }
): Rule<Fn, RuleAsyncFlag<Fn>, I> {
  return new Rule(id, stepFn, params)
}

function withFlowOptions(syncMode: boolean, options?: object): FlowOptions {
  const { stepDefaults, ...flowOptions } = (options ?? {}) as { stepDefaults?: FlowOptions['stepDefaults'] }
  return {
    ...flowOptions,
    syncMode,
    allowContext: false,
    stepDefaults: stepDefaults ?? {},
  }
}

function createFlow<SyncMode extends boolean>(syncMode: SyncMode): CreateFlowFactory<SyncMode> {
  return ((config: { step?: object; branch?: BranchOptions } = {}) => {
    const { step, branch, ...flowOptions } = config
    const flow = new Flow([], withFlowOptions(syncMode, flowOptions))

    if (step !== undefined && branch !== undefined) {
      throw new Error(`create${syncMode ? 'Sync' : 'Async'}Flow() accepts either step or branch, not both`)
    }

    if (step !== undefined) {
      return (flow.step as any)(step)
    }

    if (branch !== undefined) {
      return (flow.branch as any)(branch)
    }

    return flow
  }) as CreateFlowFactory<SyncMode>
}

export const createSyncFlow = createFlow(true)
export const createAsyncFlow = createFlow(false)
