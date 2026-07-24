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

type CombinedFlowStepOptions = { step: StepOptions; flow: FlowOptions }
type CombinedFlowBranchOptions = { branch: BranchOptions; flow: FlowOptions }

function isFlowStepConfig(value: unknown) {
  if (value == null || typeof value !== 'object') {
    return false
  }

  const step = value as Record<PropertyKey, unknown>
  const knownKeys = ['resolver', 'map', 'mapResult', 'trueIsFail']
  return (
    Reflect.ownKeys(step).every((key) => typeof key === 'string' && knownKeys.includes(key)) &&
    (step.resolver === undefined || typeof step.resolver === 'function') &&
    (step.map === undefined || typeof step.map === 'function') &&
    (step.mapResult === undefined || typeof step.mapResult === 'function') &&
    (step.trueIsFail === undefined || typeof step.trueIsFail === 'boolean')
  )
}

function isFlowConfig(value: unknown): value is object {
  if (value == null || typeof value !== 'object') {
    return false
  }

  const config = value as Record<PropertyKey, unknown>
  const knownKeys = ['name', 'description', 'step']

  return (
    Reflect.ownKeys(config).every((key) => typeof key === 'string' && knownKeys.includes(key)) &&
    (config.name === undefined || typeof config.name === 'string') &&
    (config.description === undefined || typeof config.description === 'string') &&
    (config.step === undefined || isFlowStepConfig(config.step))
  )
}

function isBranchConfig(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === 'object' &&
    'branch' in value &&
    value.branch !== null &&
    typeof value.branch === 'object' &&
    'branches' in value.branch
  )
}

function withFlowOptions(syncMode: boolean, options?: object): FlowOptions {
  const { step, ...flowOptions } = (options ?? {}) as { step?: FlowOptions['step'] }
  return {
    ...flowOptions,
    syncMode,
    allowContext: false,
    step: step ?? {},
  }
}

function withCombinedFlowOptions(syncMode: boolean, options: object): FlowOptions {
  const { resolver, map, mapResult, trueIsFail, ...flowOptions } = options as {
    resolver?: FlowOptions['step']['resolver']
    map?: FlowOptions['step']['map']
    mapResult?: FlowOptions['step']['mapResult']
    trueIsFail?: boolean
  }
  const step = {
    ...(resolver === undefined ? {} : { resolver }),
    ...(map === undefined ? {} : { map }),
    ...(mapResult === undefined ? {} : { mapResult }),
    ...(trueIsFail === undefined ? {} : { trueIsFail }),
  }
  return withFlowOptions(syncMode, { ...flowOptions, step })
}

function withStepOptions(syncMode: boolean, options?: object): CombinedFlowStepOptions {
  const { step, ...flowOptions } = (options ?? {}) as { step?: StepOptions }
  return { step: step ?? {}, flow: withCombinedFlowOptions(syncMode, flowOptions) }
}

function withBranchOptions(syncMode: boolean, options: object): CombinedFlowBranchOptions {
  const { branch, ...flowOptions } = options as { branch: BranchOptions }
  return { branch, flow: withCombinedFlowOptions(syncMode, flowOptions) }
}

function createInitialStep(first: unknown, second: unknown, options: CombinedFlowStepOptions): Flow {
  const { flow, step } = options
  const initialFlow = new Flow([], flow)
  return typeof second === 'function'
    ? (initialFlow.step as any)({ rule: first, fn: second, ...step })
    : (initialFlow.step as any)(first, step)
}

function createInitialBranch(options: CombinedFlowBranchOptions): Flow {
  const { flow, branch } = options
  const initialFlow = new Flow([], flow)
  return (initialFlow.branch as any)(branch)
}

function createFlow<SyncMode extends boolean>(syncMode: SyncMode): CreateFlowFactory<SyncMode> {
  return ((...args: unknown[]) => {
    if (args.length === 0) {
      return new Flow([], withFlowOptions(syncMode))
    }

    if (args.length === 1) {
      const [ruleOrBranchesOrConfig] = args

      if (!(ruleOrBranchesOrConfig instanceof Rule) && isFlowConfig(ruleOrBranchesOrConfig)) {
        return new Flow([], withFlowOptions(syncMode, ruleOrBranchesOrConfig))
      }

      if (ruleOrBranchesOrConfig instanceof Rule) {
        return createInitialStep(ruleOrBranchesOrConfig, undefined, withStepOptions(syncMode))
      }

      if (isBranchConfig(ruleOrBranchesOrConfig)) {
        return createInitialBranch(withBranchOptions(syncMode, ruleOrBranchesOrConfig))
      }

      throw new Error(`create${syncMode ? 'Sync' : 'Async'}Flow() branch definitions require { branch: { branches } }`)
    }

    if (args.length === 2) {
      const [ruleOrBranchesOrId, stepFnOrOptions] = args

      if (typeof stepFnOrOptions === 'function') {
        return createInitialStep(ruleOrBranchesOrId, stepFnOrOptions, withStepOptions(syncMode))
      }

      if (!(ruleOrBranchesOrId instanceof Rule)) {
        throw new Error(`create${syncMode ? 'Sync' : 'Async'}Flow() branch definitions use { branch: { branches } }`)
      }

      return createInitialStep(ruleOrBranchesOrId, undefined, withStepOptions(syncMode, stepFnOrOptions as object))
    }

    if (args.length === 3) {
      if (typeof args[1] !== 'function') {
        throw new Error(`create${syncMode ? 'Sync' : 'Async'}Flow() branch definitions use { branch: { branches } }`)
      }

      return createInitialStep(args[0], args[1], withStepOptions(syncMode, args[2] as object))
    }

    throw new Error(`create${syncMode ? 'Sync' : 'Async'}Flow() expects 0, 1, 2, or 3 arguments`)
  }) as CreateFlowFactory<SyncMode>
}

export const createSyncFlow = createFlow(true)
export const createAsyncFlow = createFlow(false)
