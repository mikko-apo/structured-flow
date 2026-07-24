import { describe, expect, expectTypeOf, it } from 'vitest'

import { convertResultNode, flattenStepResults } from '../resultUtils.ts'
import {
  createAsyncFlow,
  createSyncFlow,
  fail,
  ok,
  ruleId,
  skip,
  rule as defineRule,
  StepResult,
  stop,
  type RawStepFnResult,
  type BranchInfoType,
  type FlowOptions,
  type StepInit,
  type StepInfoType,
  type StepResultMap,
  type StepResultMapInput,
} from '../index'

type PersonData = {
  person: {
    id: string
    name: string
    age: number
  }
  route: 'approve' | 'reject'
  checks: Array<'audit' | 'rules'>
}

function meta(id: string, description: string) {
  return ruleId(id, { description })
}

function createSyncBuilder() {
  return createSyncFlow<PersonData>()
}

function createAsyncBuilder() {
  return createAsyncFlow<PersonData>()
}

describe('structuredFlow core execution', () => {
  it('uses the flow resolver to map string, RuleId, and Rule metadata', () => {
    const resolvedRule = defineRule(
      'RULE-HELPER-RES',
      ({ person }: PersonData, _params: { ctx: undefined }) => ({
        rulePersonId: person.id,
      }),
      { description: 'Rule helper description' }
    )
    const flow = createSyncFlow<PersonData>({
      step: {
        resolver: (stepId) =>
          typeof stepId === 'string'
            ? { id: `RES-${stepId}`, description: 'Resolved string id' }
            : { id: `RES-${stepId.id}`, description: `Resolved ${stepId.description ?? 'metadata'}` },
      },
    })
      .step({
        rule: 'STRING-RES',
        fn: ({ person }, _params) => ({
          stringPersonId: person.id,
        }),
      })
      .step({
        rule: meta('RULE-RES', 'Rule description'),
        fn: ({ person }, _params) => ({
          rulePersonId: person.id,
        }),
      })
      .step(resolvedRule)

    const result = flow.run({
      person: { id: 'p-res', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'RES-STRING-RES', description: 'Resolved string id' },
        { id: 'RES-RULE-RES', description: 'Resolved Rule description' },
        { id: 'RES-RULE-HELPER-RES', description: 'Resolved Rule helper description' },
      ],
    })
  })

  it('stores flow metadata from the flow options', () => {
    const flow = createSyncFlow<PersonData>({
      name: 'Person Review',
      description: 'Checks person review steps',
    }).step({
      rule: meta('NAME-0', 'No-op'),
      fn: ({ person }, _params) => ({
        personId: person.id,
      }),
    })

    expect(flow.options.name).toBe('Person Review')
    expect(flow.options.description).toBe('Checks person review steps')
    expect(flow.options.syncMode).toBe(true)
    expect(flow.options.allowContext).toBe(false)
    const options: FlowOptions = flow.options
    expect(options).toMatchObject({
      syncMode: true,
      allowContext: false,
      step: {},
      name: 'Person Review',
      description: 'Checks person review steps',
    })

    const asyncFlow = createAsyncFlow<PersonData>()
    expect(asyncFlow.options.syncMode).toBe(false)
  })

  it('creates a one-step flow directly from a rule', () => {
    const directRule = defineRule('DIRECT-RULE', ({ person }: PersonData) => ({ personId: person.id }))
    const flow = createSyncFlow(directRule)

    expect(
      convertResultNode(
        flow.run({
          person: { id: 'p1', name: 'Ada', age: 31 },
          route: 'approve',
          checks: [],
        })
      )
    ).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'DIRECT-RULE', variables: { personId: 'p1' } }],
    })
  })

  it('applies nested flow options to a flow created directly from a rule', () => {
    const directRule = defineRule('DIRECT-RULE-OPTIONS', ({ person }: PersonData) => ({
      personId: person.id,
    }))
    const chainedRule = defineRule('DIRECT-RULE-CHAINED', ({ route }: PersonData) => ({ route }))
    const flow = createSyncFlow(directRule, {
      step: {
        description: 'Initial step',
      },
      name: 'Direct rule flow',
      mapResult: ({ result }) => {
        expectTypeOf(result).toEqualTypeOf<RawStepFnResult | undefined>()
        return result == null || typeof result === 'boolean' ? result : { ...result, mapped: true }
      },
    }).step(chainedRule)

    expect(flow.options.name).toBe('Direct rule flow')
    expect(flow.steps[0]?.options?.description).toBe('Initial step')
    expect(
      convertResultNode(
        flow.run({
          person: { id: 'p1', name: 'Ada', age: 31 },
          route: 'approve',
          checks: [],
        })
      )
    ).toMatchObject({
      stepResults: [
        { id: 'DIRECT-RULE-OPTIONS', variables: { personId: 'p1', mapped: true } },
        { id: 'DIRECT-RULE-CHAINED', variables: { route: 'approve', mapped: true } },
      ],
    })
  })

  it('splits positional options between the flow and its initial step', () => {
    const flow = createSyncFlow('POSITIONAL', () => ({ checked: true }), {
      name: 'Positional flow',
      step: { description: 'Initial step' },
    })

    expect(flow.options.name).toBe('Positional flow')
    expect(flow.options.description).toBeUndefined()
    expect(convertResultNode(flow.run({}))).toMatchObject({
      stepResults: [{ id: 'POSITIONAL', description: 'Initial step' }],
    })
  })

  it('passes a separate ctx to steps when the builder uses withContext()', () => {
    type RequestCtx = {
      actorId: string
    }

    const builder = createSyncFlow<PersonData>().withContext<RequestCtx>()

    const flow = builder.step({
      rule: meta('CTX-1', 'Uses request context'),
      fn: (data, params) => ({
        actorId: params.ctx.actorId,
        personId: data.person.id,
      }),
    })

    expect(flow.options.allowContext).toBe(true)

    const result = flow.run(
      {
        person: { id: 'p0', name: 'Ada', age: 31 },
        route: 'approve',
        checks: [],
      },
      { actorId: 'user-1' }
    )

    expect(result.status).toBe('ok')
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'CTX-1', variables: { actorId: 'user-1', personId: 'p0' } }],
    })

    expectTypeOf<Parameters<typeof flow.run>>().toEqualTypeOf<[data: PersonData, ctx: RequestCtx]>()

    // @ts-expect-error second parameter must match the configured ctx type
    builder.step({
      rule: meta('CTX-2', 'Invalid ctx'),
      fn: (data, params: { ctx: { wrong: true } }) => ({
        actorId: String(params.ctx.wrong),
        personId: data.person.id,
      }),
    })
  })

  it('rejects ctx at runtime when the flow does not use withContext()', () => {
    const flow = createSyncBuilder().step({
      rule: meta('CTX-RUN-1', 'No ctx flow'),
      fn: ({ person }, _params) => ({
        personId: person.id,
      }),
    })

    expect(() =>
      (flow.run as (...args: any[]) => unknown)(
        {
          person: { id: 'p0', name: 'Ada', age: 31 },
          route: 'approve',
          checks: [],
        },
        { actorId: 'user-1' }
      )
    ).toThrow('Flow.run() expects only data when the flow does not use withContext()')
  })

  it('requires ctx at runtime when the flow uses withContext()', () => {
    type RequestCtx = {
      actorId: string
    }

    const flow = createSyncBuilder()
      .withContext<RequestCtx>()
      .step({
        rule: meta('CTX-RUN-2', 'Ctx flow'),
        fn: ({ person }, params) => ({
          actorId: params.ctx.actorId,
          personId: person.id,
        }),
      })

    expect(() =>
      (flow.run as (...args: any[]) => unknown)({
        person: { id: 'p0', name: 'Ada', age: 31 },
        route: 'approve',
        checks: [],
      })
    ).toThrow('Flow.run() expects both data and ctx when the flow uses withContext()')
  })

  it('uses rule metadata with explicit step functions and keeps ctx stable', () => {
    const flow = createSyncBuilder()
      .step({
        rule: meta('AGE-1', 'Check age'),
        fn: ({ person }, _params) => ({
          eligible: person.age >= 18,
        }),
      })
      .step({
        rule: meta('NAME-1', 'Normalize name'),
        fn: ({ person }, _params) => ({
          normalizedName: person.name.trim().toUpperCase(),
          info: 'Normalized with a custom fn override.',
        }),
        description: 'Normalize person name',
      })

    const result = flow.run({
      person: { id: 'p1', name: ' Ada ', age: 31 },
      route: 'approve',
      checks: ['audit'],
    })

    expect(flow.steps).toMatchObject([
      { id: 'AGE-1', options: { description: 'Check age' } },
      { id: 'NAME-1', options: { description: 'Normalize person name' } },
    ])
    expect(result.status).toBe('ok')
    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'AGE-1', description: 'Check age', status: 'ok', variables: { eligible: true } },
        {
          id: 'NAME-1',
          description: 'Normalize person name',
          status: 'ok',
          variables: {
            normalizedName: 'ADA',
            info: 'Normalized with a custom fn override.',
          },
        },
      ],
    })
  })

  it('allows step options to override rule metadata descriptions', () => {
    const flow = createSyncFlow<PersonData>().step({
      rule: meta('OVERRIDE-1', 'Original description'),
      fn: ({ person }, _params) => ({
        seen: person.id,
      }),
      description: 'Rule option override',
    })

    const result = flow.run({
      person: { id: 'p1b', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(flow.steps).toMatchObject([{ id: 'OVERRIDE-1', options: { description: 'Rule option override' } }])
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'OVERRIDE-1', description: 'Rule option override', status: 'ok', variables: { seen: 'p1b' } },
      ],
    })
  })

  it('lets map override the step callback data and ctx', () => {
    type FlowMap = (params: {
      stepInfo: { rawId: unknown }
      processingState: { index: number; flow: unknown }
      data: PersonData
      ctx: undefined
    }) => {
      data: { personId: string; route: PersonData['route'] }
      ctx: { submissionId: string }
    }

    let mappedFlow: unknown
    const flow = createSyncFlow<string, PersonData, FlowMap>({
      step: {
        map: ({ data, processingState }) => {
          mappedFlow = processingState.flow
          return {
            data: { personId: data.person.id, route: data.route },
            ctx: { submissionId: `${data.person.id}:${processingState.index}` },
          }
        },
      },
    }).step({
      rule: 'FNINPUT-1',
      fn: (data, params) => {
        expectTypeOf(data).toEqualTypeOf<{ personId: string; route: PersonData['route'] }>()
        expectTypeOf(params).toEqualTypeOf<{ ctx: { submissionId: string } }>()

        return {
          seen: `${data.personId}:${data.route}:${params.ctx.submissionId}`,
        }
      },
      description: 'Use mapped callback data and ctx',
    })

    const result = flow.run({
      person: { id: 'p1c', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'FNINPUT-1', variables: { seen: 'p1c:approve:p1c:0' } }],
    })
    expect(mappedFlow).toBe(flow)

    // @ts-expect-error the retained flow map only accepts the original undefined ctx
    createSyncFlow<string, PersonData, FlowMap>({ step: { map: flow.options.step.map! } }).withContext<{
      actorId: string
    }>()
  })

  it('types step init and mapResult in runtime execution order', () => {
    type Id = 'STEP-MAP-RESULT-1'
    type StateStepInfo = StepInfoType<string> | BranchInfoType<unknown>
    type MappedStepData = { personId: string }
    type MappedStepCtx = { traceId: string }
    type StepFn = (data: MappedStepData, params: { ctx: MappedStepCtx }) => { accepted: boolean }
    type StepInitializer = StepInit<
      Id,
      PersonData,
      undefined,
      MappedStepData,
      MappedStepCtx,
      PersonData,
      undefined,
      StateStepInfo
    >
    type StepResultMapper = StepResultMap<
      Id,
      MappedStepData,
      MappedStepCtx,
      RawStepFnResult | undefined,
      RawStepFnResult | undefined,
      PersonData,
      undefined,
      StateStepInfo
    >

    const init: StepInitializer = ({ stepInfo, processingState, data, ctx }) => {
      expectTypeOf(stepInfo.rawId).toEqualTypeOf<Id>()
      expectTypeOf(processingState.data).toEqualTypeOf<PersonData>()
      expectTypeOf(processingState.ctx).toEqualTypeOf<undefined>()
      expectTypeOf(processingState.flow.steps).toEqualTypeOf<readonly StateStepInfo[]>()
      expectTypeOf(data).toEqualTypeOf<PersonData>()
      expectTypeOf(ctx).toEqualTypeOf<undefined>()

      return {
        data: { personId: data.person.id },
        ctx: { traceId: data.person.id },
      }
    }
    const mapResult: StepResultMapper = ({ stepInfo, processingState, data, ctx, result }) => {
      expectTypeOf(stepInfo.rawId).toEqualTypeOf<Id>()
      expectTypeOf(processingState.data).toEqualTypeOf<PersonData>()
      expectTypeOf(processingState.ctx).toEqualTypeOf<undefined>()
      expectTypeOf(data).toEqualTypeOf<MappedStepData>()
      expectTypeOf(ctx).toEqualTypeOf<MappedStepCtx>()
      expectTypeOf(result).toEqualTypeOf<RawStepFnResult | undefined>()

      return result == null || typeof result === 'boolean' ? result : { ...result, mapped: true }
    }
    const options = { init, mapResult }
    const stepFn: StepFn = (data, params) => {
      expectTypeOf(data).toEqualTypeOf<MappedStepData>()
      expectTypeOf(params).toEqualTypeOf<{ ctx: MappedStepCtx }>()

      return { accepted: data.personId === params.ctx.traceId }
    }

    const flow = createSyncFlow<PersonData>().step({
      rule: 'STEP-MAP-RESULT-1',
      fn: stepFn,
      ...options,
    })

    const result = flow.run({
      person: { id: 'typed', name: 'Typed', age: 30 },
      route: 'approve',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ variables: { accepted: true, mapped: true } }],
    })
  })

  it('maps raw step results before normalization and lets step options override the flow mapper', () => {
    type FlowResultMap = (params: {
      stepInfo: { rawId: string }
      processingState: { index: number }
      data: PersonData
      ctx: undefined
      result: RawStepFnResult | undefined
    }) => RawStepFnResult | undefined
    type ExpectedResultInput = StepResultMapInput<
      'MAP-RESULT-1',
      PersonData,
      undefined,
      false | { passed: boolean } | undefined,
      PersonData,
      undefined,
      unknown
    >
    expectTypeOf<ExpectedResultInput>().toExtend<Parameters<FlowResultMap>[0]>()

    const flow = createSyncFlow<string, PersonData, undefined, FlowResultMap>({
      step: {
        mapResult: ({ data, result }) => {
          if (result === false) {
            return { status: 'fail', source: `flow:${data.route}` }
          }

          return result
        },
      },
    })
      .step({
        rule: 'MAP-RESULT-1',
        fn: ({ route }, _params) => (route === 'reject' ? false : { passed: true }),
        mapResult: ({ result }: { result: RawStepFnResult | undefined }) => {
          const source =
            result != null && !(result instanceof StepResult) && typeof result === 'object' && 'source' in result
              ? result.source
              : undefined

          return typeof source === 'string' &&
            source.startsWith('flow:') &&
            result != null &&
            typeof result === 'object'
            ? { ...result, status: 'ok' as const, source: `step:${source}` }
            : result
        },
      })
      .step({ rule: 'MAP-RESULT-2', fn: () => false })

    const result = flow.run({
      person: { id: 'p1d', name: 'Ada', age: 31 },
      route: 'reject',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'fail',
      stepResults: [
        { id: 'MAP-RESULT-1', status: 'ok', variables: { source: 'step:flow:reject' } },
        { id: 'MAP-RESULT-2', status: 'fail', variables: { source: 'flow:reject' } },
      ],
    })
  })

  it('rejects incompatible mapResult inputs at the step boundary', () => {
    // @ts-expect-error mapResult must accept every possible raw step result
    createSyncFlow<PersonData>().step({
      rule: 'INVALID-RESULT-MAP',
      fn: () => ({ accepted: true }),
      mapResult: ({ result }: { result: false | undefined }) => result,
    })

    expect(true).toBe(true)
  })

  it('parses status, stores the remaining payload on the step result, and supports result remapping', () => {
    const flow = createSyncBuilder()
      .step({
        rule: meta('AGE-2', 'Reject minors'),
        fn: ({ person }, _params) =>
          person.age >= 18 ? { reason: 'adult' } : fail({ variables: { reason: 'minor' } }),
        status: { fail: 'ignore' },
      })
      .step({
        rule: meta('THROW-1', 'Convert exception to fail'),
        fn: ({ route }, _params) => {
          if (route === 'reject') {
            throw new Error('boom')
          }

          return { reached: true }
        },
        status: { exception: 'fail' },
      })
      .step({
        rule: meta('AFTER-1', 'Still runs after remapped exception'),
        fn: ({ checks }, _params) => ({
          checksSeen: checks.length,
        }),
      })

    const result = flow.run({
      person: { id: 'p2', name: 'Max', age: 16 },
      route: 'reject',
      checks: ['audit', 'rules'],
    })

    expect(result.status).toBe('fail')
    expect(flattenStepResults(result.stepResults)).toEqual([
      { id: 'THROW-1', status: 'fail', description: 'Convert exception to fail', variables: {} },
    ])
    expect(convertResultNode(result)).toMatchObject({
      status: 'fail',
      stepResults: [
        { id: 'AGE-2', status: 'ok', originalStatus: 'fail', variables: { reason: 'minor' } },
        { id: 'THROW-1', status: 'fail', originalStatus: 'exception' },
        { id: 'AFTER-1', status: 'ok', variables: { checksSeen: 2 } },
      ],
    })
  })

  it('stops on stop and skips the remaining steps', () => {
    const flow = createSyncBuilder()
      .step({
        rule: meta('STOP-1', 'Stop rejected requests'),
        fn: ({ route }, _params) =>
          route === 'reject' ? stop({ variables: { decision: route } }) : { decision: route },
      })
      .step({
        rule: meta('AFTER-2', 'Skipped after stop'),
        fn: (_data, _params) => ({
          unreachable: true,
        }),
      })

    const result = flow.run({
      person: { id: 'p3', name: 'Nia', age: 23 },
      route: 'reject',
      checks: [],
    })

    expect(result.status).toBe('stop')
    expect(convertResultNode(result)).toMatchObject({
      status: 'stop',
      stepResults: [
        { id: 'STOP-1', status: 'stop', variables: { decision: 'reject' } },
        { id: 'AFTER-2', status: 'skip' },
      ],
    })
  })

  it('supports async steps and preserves the same ctx for every step', async () => {
    const flow = createAsyncBuilder()
      .step({
        rule: meta('ASYNC-1', 'Load score'),
        fn: async ({ person }, _params) => ({
          score: person.age * 2,
        }),
      })
      .step({
        rule: meta('ASYNC-2', 'Approve score'),
        fn: async ({ person, checks }, _params) => ({
          approved: person.age >= 18 && checks.includes('audit'),
        }),
      })

    const result = await flow.run({
      person: { id: 'p4', name: 'Ivy', age: 27 },
      route: 'approve',
      checks: ['audit'],
    })

    expect(result.status).toBe('ok')
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'ASYNC-1', status: 'ok', variables: { score: 54 } },
        { id: 'ASYNC-2', status: 'ok', variables: { approved: true } },
      ],
    })
  })

  it('marks a sync step as exception when a step function returns a promise at runtime', () => {
    const builderWithRuntimePromise = (createSyncBuilder().step as unknown as (...args: any[]) => unknown)({
      rule: meta('PROMISE-1', 'Unexpected promise'),
      fn: async () => ({ loaded: true }),
    }) as ReturnType<typeof createSyncBuilder>
    const flow = builderWithRuntimePromise.step({
      rule: meta('AFTER-PROMISE', 'Skipped after runtime promise'),
      fn: (_data, _params) => ({
        reached: true,
      }),
    })

    const result = flow.run({
      person: { id: 'p4b', name: 'Ivy', age: 27 },
      route: 'approve',
      checks: ['audit'],
    })

    expect(result.status).toBe('exception')
    expect(flattenStepResults(result.stepResults)).toEqual([
      { id: 'PROMISE-1', status: 'exception', description: 'Unexpected promise', variables: {} },
    ])
    expect(convertResultNode(result)).toMatchObject({
      status: 'exception',
      stepResults: [
        { id: 'PROMISE-1', status: 'exception' },
        { id: 'AFTER-PROMISE', status: 'skip' },
      ],
    })
  })

  it('converts class-based results to plain objects', () => {
    const flow = createSyncBuilder().step({
      rule: meta('CONVERT-1', 'Attach description'),
      fn: (_data, _params) => ({
        seen: true,
      }),
    })

    const result = flow.run({
      person: { id: 'p5', name: 'Jon', age: 22 },
      route: 'approve',
      checks: [],
    })

    const converted = convertResultNode(result)

    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(converted).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'CONVERT-1', description: 'Attach description', status: 'ok', variables: { seen: true } }],
    })
    expect(result.stepResults[0].variables).toEqual({ seen: true })
    expect(flattenStepResults(result.stepResults)).toEqual([])
  })

  it('checks custom step fns against the flow ctx type', () => {
    const builder = createSyncBuilder()

    builder.step({
      rule: meta('TYPE-1', 'Uses a subset of ctx'),
      fn: ({ person }, _params) => ({
        seen: person.id,
      }),
    })

    // @ts-expect-error invalid step data contract
    builder.step({
      rule: meta('TYPE-2', 'Invalid ctx access'),
      fn: ({ missing }: { missing: number }, _params: { ctx: undefined }) => ({
        seen: missing,
      }),
    })

    expectTypeOf(builder.run).toBeFunction()
  })

  it('runs helper-defined steps with rule metadata and global StepFnResult helpers', () => {
    const ageRule = ruleId('HELPER-1', { description: 'Helper age check', info: { group: 'eligibility' } })
    const helperRule = defineRule(
      ageRule.id,
      ({ person }: PersonData, _params: { ctx: undefined }) => {
        return ok({
          path: 'person.age',
          message: 'Age accepted',
          variables: { adult: person.age >= 18 },
        }).addResult(skip({ message: 'Nested detail', variables: { nested: true } }))
      },
      { path: 'person.age', description: ageRule.description, info: ageRule.info }
    )

    const flow = createSyncFlow<PersonData>().step(helperRule)
    const result = flow.run({
      person: { id: 'p6', name: 'Grace', age: 40 },
      route: 'approve',
      checks: [],
    })

    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        {
          id: 'HELPER-1',
          description: 'Helper age check',
          status: 'ok',
          path: 'person.age',
          message: 'Age accepted',
          variables: { adult: true },
          results: [{ status: 'skip', message: 'Nested detail', variables: { nested: true } }],
        },
      ],
    })
  })

  it('flattens failed step results and joins child paths with object navigation format', () => {
    const childRuleId = ruleId('PATH-FAIL-CHILD', { description: 'Child validation' })
    const flow = createSyncFlow<PersonData>().step({
      rule: 'PATH-FAIL',
      fn: () =>
        fail({
          path: 'person',
          message: 'Person is invalid',
          variables: { code: 'invalid-person' },
          results: [
            fail({ path: 'name', message: 'Name is required', variables: { required: true } }),
            fail({
              message: 'Nested details use the parent path',
              variables: { inheritedPath: true },
              results: [fail({ path: 'first', variables: { deep: true } })],
            }).addResult(childRuleId, fail({ path: 'last', message: 'Last name is required', variables: { deep: 2 } })),
          ],
        }),
    })

    const result = flow.run({
      person: { id: 'p6b', name: '', age: 40 },
      route: 'approve',
      checks: [],
    })

    expect(flattenStepResults(result.stepResults)).toEqual([
      {
        id: 'PATH-FAIL',
        status: 'fail',
        path: 'person',
        message: 'Person is invalid',
        variables: { code: 'invalid-person' },
      },
      {
        id: 'PATH-FAIL',
        status: 'fail',
        path: 'person.name',
        message: 'Name is required',
        variables: { required: true },
      },
      {
        id: 'PATH-FAIL',
        status: 'fail',
        path: 'person',
        message: 'Nested details use the parent path',
        variables: { inheritedPath: true },
      },
      { id: 'PATH-FAIL', status: 'fail', path: 'person.first', variables: { deep: true } },
      {
        id: 'PATH-FAIL-CHILD',
        status: 'fail',
        description: 'Child validation',
        path: 'person.last',
        message: 'Last name is required',
        variables: { deep: 2 },
      },
    ])
  })

  it('normalizes boolean and object step returns into result variables', () => {
    const flow = createSyncFlow<PersonData>()
      .step({ rule: 'BOOL-OK', fn: () => true })
      .step({ rule: 'OBJECT-VARS', fn: ({ person }) => ({ personId: person.id }) })
      .step({ rule: 'BOOL-FAIL', fn: () => false })

    const result = flow.run({
      person: { id: 'p7', name: 'Lin', age: 20 },
      route: 'reject',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'fail',
      stepResults: [
        { id: 'BOOL-OK', status: 'ok' },
        { id: 'OBJECT-VARS', status: 'ok', variables: { personId: 'p7' } },
        { id: 'BOOL-FAIL', status: 'fail' },
      ],
    })
    expect(
      flattenStepResults(result.stepResults, ({ failed, flattenedResult, stepResult }) =>
        flattenedResult.status === 'ok'
          ? { id: flattenedResult.id, sourceStatus: stepResult.status, failed }
          : undefined
      )
    ).toEqual([
      { id: 'BOOL-OK', sourceStatus: 'ok', failed: false },
      { id: 'OBJECT-VARS', sourceStatus: 'ok', failed: false },
    ])
  })

  it('supports flow-level trueIsFail defaults and direct step overrides', () => {
    const flow = createSyncFlow<PersonData>({
      step: { trueIsFail: true },
    })
      .step({ rule: 'TRUE-FAIL', fn: () => true })
      .step({ rule: 'FALSE-OK', fn: () => false })
      .step({ rule: 'TRUE-OVERRIDE-OK', fn: () => true, trueIsFail: false })

    const result = flow.run({
      person: { id: 'boolean-mode', name: 'Boolean', age: 30 },
      route: 'approve',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'fail',
      stepResults: [
        { id: 'TRUE-FAIL', status: 'fail' },
        { id: 'FALSE-OK', status: 'ok' },
        { id: 'TRUE-OVERRIDE-OK', status: 'ok' },
      ],
    })
  })

  it('initializes step input and overrides a Rule function', () => {
    const original = defineRule('OVERRIDE', ({ person }: PersonData) => ({ source: 'original', id: person.id }))
    const initializedRule = defineRule('RULE-INIT', ({ id }: { id: string }) => ({ id }))
    const initializedRuleFlow = createSyncFlow<PersonData>().step(initializedRule, {
      init: ({ data, ctx }) => ({ data: { id: data.person.id }, ctx }),
    })
    const flow = createSyncFlow<PersonData>().step({
      rule: original,
      init: ({ data, ctx }) => ({ data: { id: data.person.id }, ctx }),
      fn: ({ id }) => ({ source: 'override', id }),
    })

    expect(
      convertResultNode(
        flow.run({
          person: { id: 'override-id', name: 'Override', age: 30 },
          route: 'approve',
          checks: [],
        })
      )
    ).toMatchObject({
      stepResults: [{ id: 'OVERRIDE', variables: { source: 'override', id: 'override-id' } }],
    })
    expect(
      convertResultNode(
        initializedRuleFlow.run({
          person: { id: 'initialized-id', name: 'Initialized', age: 30 },
          route: 'approve',
          checks: [],
        })
      )
    ).toMatchObject({
      stepResults: [{ id: 'RULE-INIT', variables: { id: 'initialized-id' } }],
    })
  })

  it('requires step init to preserve context in sync and async context flows', async () => {
    let syncStepCalled = false
    const syncFlow = createSyncFlow<PersonData>()
      .withContext<{ actorId: string }>()
      .step({
        rule: 'SYNC-CONTEXT-INIT',
        init: (({ data }: { data: PersonData }) => ({ data })) as any,
        fn: () => {
          syncStepCalled = true
          return true
        },
      })

    const data: PersonData = {
      person: { id: 'context-init', name: 'Context', age: 30 },
      route: 'approve',
      checks: [],
    }
    expect(syncFlow.run(data, { actorId: 'sync-actor' }).status).toBe('exception')
    expect(syncStepCalled).toBe(false)

    let asyncStepCalled = false
    const asyncFlow = createAsyncFlow<PersonData>()
      .withContext<{ actorId: string }>()
      .step({
        rule: 'ASYNC-CONTEXT-INIT',
        init: (async ({ data }: { data: PersonData }) => ({ data })) as any,
        fn: async () => {
          asyncStepCalled = true
          return true
        },
      })

    expect((await asyncFlow.run(data, { actorId: 'async-actor' })).status).toBe('exception')
    expect(asyncStepCalled).toBe(false)
  })

  it('rejects helper rules that are async or use the wrong input signature in sync flows', () => {
    const asyncHelperRule = defineRule(
      'ASYNC-HELPER',
      async (_data: PersonData) => ({
        reached: true,
      }),
      { description: 'Async helper' }
    )
    const wrongInputRule = defineRule('WRONG-INPUT', (_data: { missing: true }) => true, { description: 'Wrong input' })

    // @ts-expect-error sync flows cannot accept async helper rules
    createSyncFlow<PersonData>().step(asyncHelperRule)

    // @ts-expect-error helper rule input data must match the flow data
    createSyncFlow<PersonData>().step(wrongInputRule)
  })

  it('awaits every runtime callback in async mode', async () => {
    const calls: string[] = []
    const flowMap = async ({ data, ctx }: { data: PersonData; ctx: undefined }) => {
      await Promise.resolve()
      calls.push('flow map')
      return { data, ctx }
    }
    const flowResultMap = async ({ result }: { result: RawStepFnResult | undefined }) => {
      await Promise.resolve()
      calls.push('flow result map')
      return result
    }
    const branchFlow = createAsyncFlow<PersonData>().step({
      rule: 'ASYNC-BRANCH-STEP',
      fn: ({ person }) => {
        calls.push('branch step')
        return { branchPersonId: person.id }
      },
    })
    const flow = createAsyncFlow<string, PersonData, typeof flowMap, typeof flowResultMap>({
      step: {
        map: flowMap,
        mapResult: flowResultMap,
      },
    })
      .branch({
        init: async ({ data }) => {
          await Promise.resolve()
          calls.push('branch init')
          return { keys: 'selected', data }
        },
        branches: { selected: branchFlow },
      })
      .step({
        rule: 'ASYNC-MAPPED-STEP',
        fn: () => {
          calls.push('mapped step')
          return { mapped: true }
        },
        init: async ({ data, ctx }) => {
          await Promise.resolve()
          calls.push('step init')
          return { data, ctx }
        },
        mapResult: async ({ result }) => {
          await Promise.resolve()
          calls.push('step result map')
          return result
        },
      })

    const result = await flow.run({
      person: { id: 'async-person', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(result.status).toBe('ok')
    expect(calls).toEqual([
      'flow map',
      'branch init',
      'branch step',
      'flow map',
      'step init',
      'mapped step',
      'flow result map',
      'step result map',
    ])
  })

  it('type-checks callback async behavior from syncMode', () => {
    const asyncMap = async ({ data, ctx }: { data: PersonData; ctx: undefined }) => ({ data, ctx })
    const asyncResultMap = async ({ result }: { result: RawStepFnResult | undefined }) => result

    createAsyncFlow<string, PersonData, typeof asyncMap, typeof asyncResultMap>({
      step: {
        map: asyncMap,
        mapResult: asyncResultMap,
      },
    })
      .branch({ init: async () => 'selected', branches: { selected: createAsyncFlow<PersonData>() } })
      .step({
        rule: 'ASYNC-TYPE-STEP',
        fn: async () => true,
        init: async ({ data, ctx }) => ({ data, ctx }),
        mapResult: async ({ result }) => result,
      })

    // @ts-expect-error sync flow maps must return synchronously
    createSyncFlow<PersonData>({
      step: {
        map: async ({ data, ctx }: { data: PersonData; ctx: undefined }) => ({ data, ctx }),
      },
    })

    // @ts-expect-error sync flow result maps must return synchronously
    createSyncFlow<PersonData>({
      step: {
        mapResult: async ({ result }: { result: RawStepFnResult | undefined }) => result,
      },
    })

    createSyncFlow<PersonData>().branch({
      // @ts-expect-error sync branch initializers must return synchronously
      init: async () => 'selected',
      branches: { selected: createSyncFlow<PersonData>() },
    })

    // @ts-expect-error sync step initializers must return synchronously
    createSyncFlow<PersonData>().step({
      rule: 'SYNC-TYPE-STEP',
      fn: () => true,
      init: async ({ data, ctx }) => ({ data, ctx }),
    })

    // @ts-expect-error sync step result maps must return synchronously
    createSyncFlow<PersonData>().step({
      rule: 'SYNC-RESULT-TYPE-STEP',
      fn: () => true,
      mapResult: async ({ result }) => result,
    })
  })
})
