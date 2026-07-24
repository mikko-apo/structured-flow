import {
  type BranchOptions,
  type FlowOptions,
  Rule,
  RuleId,
  StepFnResult,
  type StepFnResultOptions,
  type StepOptions,
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
  return ((
    config: {
      step?: Rule | (Omit<StepOptions, 'fn'> & { fn?: StepOptions['fn'] })
      branch?: BranchOptions
    } = {}
  ) => {
    const { step, branch, ...flowOptions } = config
    const flow = new Flow([], withFlowOptions(syncMode, flowOptions))

    if (step !== undefined && branch !== undefined) {
      throw new Error(`create${syncMode ? 'Sync' : 'Async'}Flow() accepts either step or branch, not both`)
    }

    if (step !== undefined) {
      if (!(step instanceof Rule) && step.rule instanceof Rule && step.fn === undefined) {
        const { rule, ...stepOptions } = step
        return (flow.step as any)(rule, stepOptions)
      }

      return (flow.step as any)(step)
    }

    if (branch !== undefined) {
      return (flow.branch as any)(branch)
    }

    return flow
  }) as CreateFlowFactory<SyncMode>
}

/**
 * `createSyncFlow()` and `createAsyncFlow()` support these forms:
 *
 * - `createXFlow()`
 * - `createXFlow(flowOptions)`
 * - `createXFlow({ ...flowOptions, step: rule })`
 * - `createXFlow({ ...flowOptions, step: { rule, fn?, ...stepParams } })`
 * - `createXFlow({ ...flowOptions, branch: { branches, init?, ...branchParams } })`
 *
 * Flow options:
 *
 * - `name`: optional display name.
 * - `description`: optional human-readable description.
 * - `stepDefaults.resolver`: resolves step ids and descriptions.
 * - `stepDefaults.map`: maps data and context before every step or branch initializer.
 * - `stepDefaults.mapResult`: maps every raw step result before a step-specific mapper.
 * - `stepDefaults.trueIsFail`: treats boolean `true` as `fail` and `false` as `ok` by default.
 * - `step`: optional initial `Rule` or step object; `fn` is optional for a `Rule` and required for a `RuleId` or string.
 * - `branch`: optional initial branch using the same parameters as `Flow.branch({ ... })`.
 *
 * `syncMode` is selected by the factory, and `allowContext` is enabled by `withContext()`.
 * The `step` and `branch` initializers are mutually exclusive.
 *
 * `createSyncFlow()` accepts only synchronous callbacks. `createAsyncFlow()` accepts synchronous or asynchronous callbacks.
 */
export const createSyncFlow = createFlow(true)
export const createAsyncFlow = createFlow(false)
