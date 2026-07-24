import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  convertResultNode,
  createAsyncFlow,
  createSyncFlow,
  type FlowResult,
  type RawStepFnResult,
  rule,
  ruleId,
} from '../index.ts'

type ApiData = {
  value: string
  route: 'first' | 'second'
}

const apiData: ApiData = {
  value: 'sample',
  route: 'second',
}

describe('flow API', () => {
  it('supports empty and flow-options-only forms', () => {
    const emptyFlow = createSyncFlow<ApiData>()
    const configuredFlow = createSyncFlow<ApiData>({
      name: 'Configured flow',
      description: 'Flow metadata',
      stepDefaults: {
        trueIsFail: true,
      },
    })
    const asyncFlow = createAsyncFlow<ApiData>()

    expectTypeOf(emptyFlow.run(apiData)).toEqualTypeOf<FlowResult>()
    expectTypeOf(asyncFlow.run(apiData)).toEqualTypeOf<Promise<FlowResult>>()
    expect(emptyFlow.run(apiData).status).toBe('skip')
    expect(configuredFlow.options).toMatchObject({
      name: 'Configured flow',
      description: 'Flow metadata',
      stepDefaults: { trueIsFail: true },
    })
  })

  it('types flow-level maps and their mapped step input', () => {
    const map = ({ data, ctx }: { data: ApiData; ctx: undefined }) => {
      expectTypeOf(data).toEqualTypeOf<ApiData>()
      expectTypeOf(ctx).toEqualTypeOf<undefined>()
      return {
        data: { length: data.value.length },
        ctx: { source: 'mapped' as const },
      }
    }
    const mapResult = ({ result }: { result: RawStepFnResult }) => {
      expectTypeOf(result).toEqualTypeOf<RawStepFnResult>()
      return result
    }
    const flow = createSyncFlow<ApiData, typeof map, typeof mapResult>({
      stepDefaults: {
        map,
        mapResult,
      },
    }).step({
      rule: 'FLOW-MAPPED-STEP',
      fn: (data, { ctx }) => {
        expectTypeOf(data).toEqualTypeOf<{ length: number }>()
        expectTypeOf(ctx).toEqualTypeOf<{ source: 'mapped' }>()
        return { length: data.length, source: ctx.source }
      },
    })

    expect(convertResultNode(flow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'FLOW-MAPPED-STEP', variables: { length: 6, source: 'mapped' } }],
    })
  })

  it('supports a Rule directly and a Rule options object without fn', () => {
    const apiRule = rule('RULE-STEP', ({ value }: ApiData) => ({ value }))
    const directFlow = createSyncFlow({ step: apiRule })
    const optionsFlow = createSyncFlow({
      name: 'Rule options flow',
      step: {
        rule: apiRule,
        mapResult: ({ data, result }) => {
          expectTypeOf(data).toEqualTypeOf<ApiData>()
          expectTypeOf(result).toEqualTypeOf<RawStepFnResult>()
          return typeof result === 'boolean' ? result : { ...result, mapped: true }
        },
      },
    })

    expectTypeOf(directFlow.run(apiData)).toEqualTypeOf<FlowResult>()
    expect(convertResultNode(directFlow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'RULE-STEP', variables: { value: 'sample' } }],
    })
    expect(convertResultNode(optionsFlow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'RULE-STEP', variables: { value: 'sample', mapped: true } }],
    })
  })

  it('supports overriding the function carried by a Rule', () => {
    const apiRule = rule('OVERRIDDEN-RULE', ({ value }: ApiData) => ({ original: value }))
    const flow = createSyncFlow({
      step: {
        rule: apiRule,
        fn: ({ value }: ApiData) => ({ overridden: value.length }),
      },
    })

    expect(convertResultNode(flow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'OVERRIDDEN-RULE', variables: { overridden: 6 } }],
    })
  })

  it('supports string and RuleId step objects', () => {
    const stringFlow = createSyncFlow({
      step: {
        rule: 'STRING-STEP',
        fn: ({ value }: ApiData) => ({ value }),
      },
    })
    const idFlow = createSyncFlow({
      step: {
        rule: ruleId('RULE-ID-STEP', { description: 'Rule id step' }),
        fn: ({ route }: ApiData) => ({ route }),
      },
    })

    expect(convertResultNode(stringFlow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'STRING-STEP', variables: { value: 'sample' } }],
    })
    expect(convertResultNode(idFlow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'RULE-ID-STEP', description: 'Rule id step', variables: { route: 'second' } }],
    })
  })

  it('supports an initialized step object', () => {
    const flow = createSyncFlow({
      step: {
        rule: 'INITIALIZED-STEP',
        init: ({ data }: { data: ApiData }) => ({
          data: { length: data.value.length },
          ctx: { route: data.route },
        }),
        fn: (data, { ctx }) => {
          expectTypeOf(data).toEqualTypeOf<{ length: number }>()
          expectTypeOf(ctx).toEqualTypeOf<{ route: ApiData['route'] }>()
          return { length: data.length, route: ctx.route }
        },
        mapResult: ({ data, ctx, result }) => {
          expectTypeOf(data).toEqualTypeOf<{ length: number }>()
          expectTypeOf(ctx).toEqualTypeOf<{ route: ApiData['route'] }>()
          expectTypeOf(result).toEqualTypeOf<RawStepFnResult>()
          return result
        },
      },
    })
    expect(convertResultNode(flow.run(apiData))).toMatchObject({
      stepResults: [{ id: 'INITIALIZED-STEP', variables: { length: 6, route: 'second' } }],
    })
  })

  it('supports every follow-up step syntax', () => {
    const initialRule = rule('INITIAL-RULE', ({ value }: ApiData) => ({ initial: value }))
    const directRule = rule('DIRECT-RULE', ({ value }: ApiData) => ({ direct: value }))
    const optionsRule = rule('OPTIONS-RULE', ({ value }: ApiData) => ({ options: value }))
    const objectRule = rule('RULE-OBJECT-WITHOUT-FN', ({ value }: ApiData) => ({ objectRule: value }))
    const initializedRule = rule('INITIALIZED-RULE', ({ value, route }: ApiData) => ({
      initializedRule: value,
      route,
    }))
    const initializedObjectRule = rule(
      'INITIALIZED-RULE-OBJECT-WITHOUT-FN',
      (data: { length: number }, { ctx }: { ctx: { route: ApiData['route'] } }) => ({
        initializedObjectRule: data.length,
        route: ctx.route,
      })
    )

    const flow = createSyncFlow({ step: initialRule })
      .step(directRule)
      .step({
        rule: objectRule,
        mapResult: ({ result }) => result,
      })
      .step(optionsRule, {
        description: 'Rule with step options',
      })
      .step(initializedRule, {
        init: ({ data }) => ({
          data: { ...data, value: data.value.toUpperCase() },
          ctx: undefined,
        }),
      })
      .step({
        rule: initializedObjectRule,
        init: ({ data }) => ({
          data: { length: data.value.length },
          ctx: { route: data.route },
        }),
      })
      .step({
        rule: 'STRING-OBJECT-RULE',
        fn: ({ value }) => ({ stringObject: value }),
      })
      .step({
        rule: ruleId('RULE-ID-OBJECT', { description: 'RuleId object step' }),
        fn: ({ route }) => ({ ruleIdObject: route }),
      })
      .step({
        rule: directRule,
        fn: ({ value }) => ({ overriddenRule: value.length }),
      })
      .step({
        rule: 'INITIALIZED-OBJECT-RULE',
        init: ({ data }) => ({
          data: { value: data.value.toUpperCase() },
          ctx: { route: data.route },
        }),
        fn: (data, { ctx }) => ({ initializedObject: data.value, route: ctx.route }),
      })

    expect(convertResultNode(flow.run(apiData))).toMatchObject({
      stepResults: [
        { id: 'INITIAL-RULE', variables: { initial: 'sample' } },
        { id: 'DIRECT-RULE', variables: { direct: 'sample' } },
        { id: 'RULE-OBJECT-WITHOUT-FN', variables: { objectRule: 'sample' } },
        { id: 'OPTIONS-RULE', description: 'Rule with step options', variables: { options: 'sample' } },
        { id: 'INITIALIZED-RULE', variables: { initializedRule: 'SAMPLE', route: 'second' } },
        {
          id: 'INITIALIZED-RULE-OBJECT-WITHOUT-FN',
          variables: { initializedObjectRule: 6, route: 'second' },
        },
        { id: 'STRING-OBJECT-RULE', variables: { stringObject: 'sample' } },
        { id: 'RULE-ID-OBJECT', description: 'RuleId object step', variables: { ruleIdObject: 'second' } },
        { id: 'DIRECT-RULE', variables: { overriddenRule: 6 } },
        { id: 'INITIALIZED-OBJECT-RULE', variables: { initializedObject: 'SAMPLE', route: 'second' } },
      ],
    })
  })

  it('supports initial branches with and without init', () => {
    const firstFlow = createSyncFlow({
      step: {
        rule: 'FIRST-BRANCH-STEP',
        fn: ({ value }: ApiData) => ({ first: value }),
      },
    })
    const secondFlow = createSyncFlow({
      step: {
        rule: 'SECOND-BRANCH-STEP',
        fn: ({ value }: ApiData) => ({ second: value }),
      },
    })
    const allBranchesFlow = createSyncFlow<ApiData>({
      branch: {
        branches: {
          first: firstFlow,
          second: secondFlow,
        },
      },
    })

    type ParentData = { nested: ApiData }
    const selectedBranchFlow = createSyncFlow<ParentData>({
      branch: {
        init: ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<ParentData>()
          return {
            keys: data.nested.route,
            data: data.nested,
          }
        },
        branches: {
          first: firstFlow,
          second: secondFlow,
        },
      },
    })
    const followUpSelectedBranchFlow = createSyncFlow<ParentData>().branch({
      init: ({ data }) => ({
        keys: data.nested.route,
        data: data.nested,
      }),
      branches: {
        first: firstFlow,
        second: secondFlow,
      },
    })

    const allResult = allBranchesFlow.run(apiData)
    const selectedResult = selectedBranchFlow.run({ nested: apiData })
    const followUpSelectedResult = followUpSelectedBranchFlow.run({ nested: apiData })
    const allBranches = allResult.stepResults[0]?.branches ?? []
    const selectedBranches = selectedResult.stepResults[0]?.branches ?? []
    const followUpSelectedBranches = followUpSelectedResult.stepResults[0]?.branches ?? []

    expect(allBranches.find(({ key }) => key === 'first')?.status).toBe('ok')
    expect(allBranches.find(({ key }) => key === 'second')?.status).toBe('ok')
    expect(selectedBranches.find(({ key }) => key === 'first')?.status).toBe('skip')
    expect(selectedBranches.find(({ key }) => key === 'second')?.status).toBe('ok')
    expect(followUpSelectedBranches.find(({ key }) => key === 'first')?.status).toBe('skip')
    expect(followUpSelectedBranches.find(({ key }) => key === 'second')?.status).toBe('ok')
  })

  it('supports every follow-up branch syntax', () => {
    const firstFlow = createSyncFlow({
      step: rule('FOLLOW-UP-FIRST', ({ value }: ApiData) => ({ first: value })),
    }).step(rule('FOLLOW-UP-FIRST-SECOND-STEP', ({ route }: ApiData) => ({ firstRoute: route })))
    const secondFlow = createSyncFlow({
      step: rule('FOLLOW-UP-SECOND', ({ value }: ApiData) => ({ second: value })),
    })
    const branches = {
      first: firstFlow,
      second: secondFlow,
    }
    const flow = createSyncFlow<ApiData>({
      branch: { branches },
    })
      .branch({
        branches,
        init: ({ data }) => data.route,
      })
      .branch({
        branches,
        init: () => ['first', 'second'] as const,
      })
      .branch({
        branches,
        init: ({ data }) => ({
          keys: data.route,
          data: { ...data, value: data.value.toUpperCase() },
        }),
      })
      .step(rule('AFTER-BRANCH', ({ value }: ApiData) => ({ afterBranch: value })))

    const result = flow.run(apiData)
    const [all, selected, multiple, mapped, finalStep] = result.stepResults
    const mappedSecond = mapped?.branches?.find(({ key }) => key === 'second')

    expect(all?.branches?.find(({ key }) => key === 'first')?.status).toBe('ok')
    expect(all?.branches?.find(({ key }) => key === 'second')?.status).toBe('ok')
    expect(selected?.branches?.find(({ key }) => key === 'first')?.status).toBe('skip')
    expect(selected?.branches?.find(({ key }) => key === 'second')?.status).toBe('ok')
    expect(multiple?.branches?.find(({ key }) => key === 'first')?.status).toBe('ok')
    expect(multiple?.branches?.find(({ key }) => key === 'second')?.status).toBe('ok')
    expect(mapped?.branches?.find(({ key }) => key === 'first')?.status).toBe('skip')
    expect(mappedSecond?.status).toBe('ok')
    expect(convertResultNode(finalStep!)).toMatchObject({
      id: 'AFTER-BRANCH',
      variables: { afterBranch: 'sample' },
    })
    expect(mappedSecond).toBeDefined()
    expect(convertResultNode(mappedSecond!)).toMatchObject({
      key: 'second',
      stepResults: [{ id: 'FOLLOW-UP-SECOND', variables: { second: 'SAMPLE' } }],
    })
  })

  it('supports every run syntax', async () => {
    const syncFlow = createSyncFlow({
      step: rule('SYNC-RUN', ({ value }: ApiData) => ({ value })),
    })
    const syncContextFlow = createSyncFlow<ApiData>()
      .withContext<{ suffix: string }>()
      .step({
        rule: 'SYNC-CONTEXT-RUN',
        fn: ({ value }, { ctx }) => ({ value: `${value}${ctx.suffix}` }),
      })
    const asyncFlow = createAsyncFlow({
      step: rule('ASYNC-RUN', async ({ value }: ApiData) => ({ value })),
    })
    const asyncContextFlow = createAsyncFlow<ApiData>()
      .withContext<{ suffix: string }>()
      .step({
        rule: 'ASYNC-CONTEXT-RUN',
        fn: async ({ value }, { ctx }) => ({ value: `${value}${ctx.suffix}` }),
      })

    const syncResult = syncFlow.run(apiData)
    const syncContextResult = syncContextFlow.run(apiData, { suffix: '-sync' })
    const asyncResult = asyncFlow.run(apiData)
    const asyncContextResult = asyncContextFlow.run(apiData, { suffix: '-async' })

    expectTypeOf(syncResult).toEqualTypeOf<FlowResult>()
    expectTypeOf(syncContextResult).toEqualTypeOf<FlowResult>()
    expectTypeOf(asyncResult).toEqualTypeOf<Promise<FlowResult>>()
    expectTypeOf(asyncContextResult).toEqualTypeOf<Promise<FlowResult>>()
    expect(convertResultNode(syncContextResult)).toMatchObject({
      stepResults: [{ variables: { value: 'sample-sync' } }],
    })
    expect(convertResultNode(await asyncResult)).toMatchObject({
      stepResults: [{ variables: { value: 'sample' } }],
    })
    expect(convertResultNode(await asyncContextResult)).toMatchObject({
      stepResults: [{ variables: { value: 'sample-async' } }],
    })

    const typecheckOnly = () => {
      // @ts-expect-error flows without context accept only data
      syncFlow.run(apiData, { suffix: 'extra' })

      // @ts-expect-error context flows require a context argument
      syncContextFlow.run(apiData)

      // @ts-expect-error run data must match the flow data type
      syncFlow.run({ value: 123, route: 'first' })
    }

    expect(typecheckOnly).toBeTypeOf('function')
  })

  it('supports asynchronous rule, initialized-step, and branch forms', async () => {
    const asyncRule = rule('ASYNC-RULE', async ({ value }: ApiData) => ({ value }))
    const directRuleFlow = createAsyncFlow({ step: asyncRule })
    const ruleOptionsFlow = createAsyncFlow({
      step: {
        rule: asyncRule,
        mapResult: async ({ result }) => result,
      },
    })
    const initializedFlow = createAsyncFlow({
      step: {
        rule: 'ASYNC-INITIALIZED-STEP',
        init: async ({ data }: { data: ApiData }) => ({
          data: { value: data.value },
          ctx: { route: data.route },
        }),
        fn: async (data, { ctx }) => ({ value: data.value, route: ctx.route }),
        mapResult: async ({ result }) => result,
      },
    })
    const branchChild = createAsyncFlow({
      step: {
        rule: 'ASYNC-BRANCH-CHILD',
        fn: async ({ value }: ApiData) => ({ value }),
      },
    })
    const branchFlow = createAsyncFlow<ApiData>({
      branch: {
        init: async ({ data }) => data.route,
        branches: {
          first: branchChild,
          second: branchChild,
        },
      },
    })

    expectTypeOf(directRuleFlow.run(apiData)).toEqualTypeOf<Promise<FlowResult>>()
    expect((await directRuleFlow.run(apiData)).status).toBe('ok')
    expect((await ruleOptionsFlow.run(apiData)).status).toBe('ok')
    expect((await initializedFlow.run(apiData)).status).toBe('ok')
    expect((await branchFlow.run(apiData)).status).toBe('ok')
  })

  it('rejects unsupported factory forms at compile time', () => {
    const syncRule = rule('SYNC-RULE', ({ value }: ApiData) => ({ value }))
    const asyncRule = rule('ASYNC-RULE', async ({ value }: ApiData) => ({ value }))
    const flow = createSyncFlow<ApiData>()
    const typecheckOnly = () => {
      // @ts-expect-error string step objects require fn
      createSyncFlow({ step: { rule: 'MISSING-FN' } })

      // @ts-expect-error RuleId step objects require fn
      createSyncFlow({ step: { rule: ruleId('MISSING-FN') } })

      // @ts-expect-error sync factories reject async rules
      createSyncFlow({ step: asyncRule })

      // @ts-expect-error fluent string step objects require fn
      flow.step({ rule: 'MISSING-FN' })

      // @ts-expect-error fluent RuleId step objects require fn
      flow.step({ rule: ruleId('MISSING-FN') })

      // @ts-expect-error sync flows reject async Rule objects when fn is omitted
      flow.step({ rule: asyncRule })

      // @ts-expect-error rule is nested under step
      createSyncFlow({ rule: syncRule })

      const stepAndBranch = {
        step: syncRule,
        branch: { branches: { selected: createSyncFlow<ApiData>() } },
      }
      // @ts-expect-error step and branch are mutually exclusive
      createSyncFlow(stepAndBranch)
    }

    expect(typecheckOnly).toBeTypeOf('function')
  })
})
