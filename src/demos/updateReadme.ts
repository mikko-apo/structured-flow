import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow.ts'

import { writeMarkdownDocumentation } from './renderMarkdownDocumentation.ts'

/* SEQUENCE:START */
type SubmittedForm = { id: string }
type Occupancy = { id: string }

function getOccupancies({ form }: { form: SubmittedForm }) {
  return {
    occupancies: form.id === '123' ? [{ id: 'a' + form.id }] : [{ id: 'a' + form.id }, { id: 'b' + form.id }],
  }
}

function verifyOccupancyCount({ form, occupancies }: { form: SubmittedForm; occupancies: Occupancy[] }) {
  if (form.id === '300') {
    return stepResult({
      result: 'stop',
      info: 'The first two records are enough here, so the sequence can finish early.',
    })
  }

  if (form.id === '400') {
    return stepResult({
      result: 'exception',
      info: 'A contradictory record was discovered, so the sequence stops immediately.',
    })
  }

  return stepResult({
    result: occupancies.length === 2 ? 'ok' : 'error',
    info:
      occupancies.length === 2
        ? 'Recovered the full two-record occupancy trail.'
        : 'Expected two occupancy records but found an incomplete trail.',
  })
}

async function crossCheckFormAndOccupancies({ form }: { form: SubmittedForm; occupancies: Occupancy[] }) {
  return stepResult({
    result: form.id === '400' ? 'error' : 'ok',
    info:
      form.id === '123'
        ? 'The submitted form is acceptable, but the occupancy trail is still incomplete.'
        : 'The submitted form and occupancy trail tell a consistent story.',
  })
}

const sequence = createAsyncFlow('IC10', 'Get linked occupancy records', getOccupancies)
  .step('IC25', 'Count the recovered occupancy trail and insist on exactly two records', verifyOccupancyCount)
  .step('IC30', 'Cross-check the submitted form against the recovered occupancy trail', crossCheckFormAndOccupancies)
  .build()
/* SEQUENCE:END */

/* STRUCTURED_STEP_DESCRIPTION:START */
type StepMeta = {
  label: string
  area: 'billing' | 'risk'
  severity: 'low' | 'high'
}

const autoReviewFlow = createSyncFlow(
  'AUTO-1',
  { label: 'Auto approve', area: 'risk', severity: 'low' },
  ({ amount, normalizedAmount }: { amount: number; normalizedAmount: number }) => ({
    autoApproved: normalizedAmount <= Math.abs(amount),
  })
)

const manualReviewFlow = createSyncFlow(
  'MANUAL-1',
  { label: 'Manual review', area: 'risk', severity: 'high' },
  ({ normalizedAmount }: { amount: number; normalizedAmount: number }) => ({
    queuedForReview: normalizedAmount > 1000,
  })
)

const structuredStepDescriptionFlow = createSyncFlow<StepMeta>(
  'VALIDATE',
  { label: 'Validate amount', area: 'billing', severity: 'high' },
  ({ amount }) => ({
    normalizedAmount: Math.abs(amount),
  })
)
  .branch(
    'ROUTE',
    { label: 'Route review', area: 'risk', severity: 'low' },
    ({ normalizedAmount }) => (normalizedAmount > 1000 ? 'manual' : 'auto'),
    {
      auto: autoReviewFlow,
      manual: manualReviewFlow,
    }
  )
  .build()
/* STRUCTURED_STEP_DESCRIPTION:END */

/* BRANCH_ONE_OF_THREE:START */
type PostingKind = 'income' | 'expense' | 'transfer'

const incomeFlow = createSyncFlow('IN-1', 'Handle income', ({ amount }: { amount: number; kind: PostingKind }) => ({
  normalizedAmount: amount,
}))

const expenseFlow = createSyncFlow('EX-1', 'Handle expense', ({ amount }: { amount: number; kind: PostingKind }) => ({
  normalizedAmount: -amount,
}))

const transferFlow = createSyncFlow('TR-1', 'Handle transfer', ({ kind }: { amount: number; kind: PostingKind }) => ({
  transferSeen: kind === 'transfer',
}))

const oneOfThreeBranchFlow = createSyncFlow(
  'ROUTE',
  'Route posting kind',
  ({ kind }: { amount: number; kind: PostingKind }) => kind,
  {
    income: incomeFlow,
    expense: expenseFlow,
    transfer: transferFlow,
  }
).build()
/* BRANCH_ONE_OF_THREE:END */

/* BRANCH_TWO_OF_THREE:START */
type CheckName = 'tax' | 'fraud' | 'policy'

const taxFlow = createAsyncFlow(
  'TAX-1',
  'Check taxes',
  async ({ checks }: { amount: number; checks: CheckName[] }) => ({
    taxChecked: checks.includes('tax'),
  })
)

const fraudFlow = createAsyncFlow(
  'FRAUD-1',
  'Check fraud',
  async ({ checks }: { amount: number; checks: CheckName[] }) =>
    stepResult({
      result: checks.includes('fraud') ? 'error' : 'skip',
      info: 'Fraud review failed.',
    })
)

const policyFlow = createAsyncFlow(
  'POLICY-1',
  'Check policy',
  async ({ checks }: { amount: number; checks: CheckName[] }) => ({
    policyChecked: checks.includes('policy'),
  })
)

const twoOfThreeBranchFlow = createAsyncFlow(
  'CHECKS',
  'Run selected checks',
  ({ checks }: { amount: number; checks: CheckName[] }) => checks,
  {
    tax: taxFlow,
    fraud: fraudFlow,
    policy: policyFlow,
  }
).build()
/* BRANCH_TWO_OF_THREE:END */

/* NESTED_BRANCH:START */
type FirstBranch = 'A' | 'B'
type SecondBranch = 'C' | 'D'

const branchAFlow = createSyncFlow(
  'A-1',
  'Handle A',
  ({ firstBranch }: { firstBranch: FirstBranch; secondBranch: SecondBranch }) => ({
    visitedA: firstBranch === 'A',
  })
)

const branchCFlow = createSyncFlow(
  'C-1',
  'Handle C',
  ({ secondBranch }: { firstBranch: FirstBranch; secondBranch: SecondBranch }) => ({
    visitedC: secondBranch === 'C',
  })
)

const branchDFlow = createSyncFlow(
  'D-1',
  'Handle D',
  ({ secondBranch }: { firstBranch: FirstBranch; secondBranch: SecondBranch }) => ({
    visitedD: secondBranch === 'D',
  })
)

const branchBFlow = createSyncFlow(
  'B-ROUTE',
  'Route second branch',
  ({ secondBranch }: { firstBranch: FirstBranch; secondBranch: SecondBranch }) => secondBranch,
  {
    C: branchCFlow,
    D: branchDFlow,
  }
)

const nestedBranchFlow = createSyncFlow(
  'ROOT-ROUTE',
  'Route first branch',
  ({ firstBranch }: { firstBranch: FirstBranch; secondBranch: SecondBranch }) => firstBranch,
  {
    A: branchAFlow,
    B: branchBFlow,
  }
).build()
/* NESTED_BRANCH:END */

/* BRANCH_SKIP:START */
const approveFlow = createSyncFlow('APP-1', 'Approve', ({ shouldRunChecks }: { shouldRunChecks: boolean }) => ({
  approved: !shouldRunChecks,
}))

const rejectFlow = createSyncFlow('REJ-1', 'Reject', ({ shouldRunChecks }: { shouldRunChecks: boolean }) => ({
  rejected: !shouldRunChecks,
}))

const reviewFlow = createSyncFlow('REV-1', 'Review', ({ shouldRunChecks }: { shouldRunChecks: boolean }) => ({
  reviewed: shouldRunChecks,
}))

const skippedBranchFlow = createSyncFlow(
  'OPTIONAL-CHECKS',
  'Optionally run checks',
  ({ shouldRunChecks }: { shouldRunChecks: boolean }) => (shouldRunChecks ? 'review' : 'skip'),
  {
    approve: approveFlow,
    reject: rejectFlow,
    review: reviewFlow,
  }
).build()
/* BRANCH_SKIP:END */

export async function writeStructuredProcessExampleMarkdown(
  outputFile = join(dirname(fileURLToPath(import.meta.url)), '../..', 'README.md')
) {
  const templateFile = join(dirname(fileURLToPath(import.meta.url)), 'structuredFlowDemo.readme.template.md')
  const documentationSourceFile = fileURLToPath(import.meta.url)

  await writeMarkdownDocumentation({
    templateFile,
    documentationSourceFile,
    outputFile,
    logMarkers: true,
    generatedExamples: [
      {
        id: 'SEQUENCE',
        flow: sequence,
        demos: [
          { id: 'PASSING', init: { form: { id: '200' } } },
          { id: 'FAILING', init: { form: { id: '123' } } },
          { id: 'STOP', init: { form: { id: '300' } } },
          { id: 'EXCEPTION', init: { form: { id: '400' } } },
        ],
      },
      {
        id: 'STRUCTURED_STEP_DESCRIPTION',
        flow: structuredStepDescriptionFlow,
        demos: [{ id: 'DEMO', init: { amount: -1400 } }],
      },
      {
        id: 'BRANCH_ONE_OF_THREE',
        flow: oneOfThreeBranchFlow,
        demos: [{ id: 'DEMO', init: { amount: 24, kind: 'expense' } }],
      },
      {
        id: 'BRANCH_TWO_OF_THREE',
        flow: twoOfThreeBranchFlow,
        demos: [{ id: 'DEMO', init: { amount: 8, checks: ['tax', 'fraud'] } }],
      },
      {
        id: 'NESTED_BRANCH',
        flow: nestedBranchFlow,
        demos: [{ id: 'DEMO', init: { firstBranch: 'B', secondBranch: 'D' } }],
      },
      {
        id: 'BRANCH_SKIP',
        flow: skippedBranchFlow,
        demos: [{ id: 'DEMO', init: { shouldRunChecks: false } }],
      },
    ],
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeStructuredProcessExampleMarkdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
