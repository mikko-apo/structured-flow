import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { writeStructuredProcessExampleMarkdown } from '../demos/updateReadme.ts'

function sliceBetween(value: string, startMarker: string, endMarker: string): string {
  const startIndex = value.indexOf(startMarker)
  const endIndex = value.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Could not find markers "${startMarker}" and "${endMarker}"`)
  }

  return value.slice(startIndex + startMarker.length, endIndex)
}

describe('updateReadme branch rendering', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders branch steps into generated mermaid blocks and html tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'structured-flow-readme-'))
    tempDirs.push(dir)
    const outputFile = join(dir, 'README.generated.md')

    await writeStructuredProcessExampleMarkdown(outputFile)

    const markdown = readFileSync(outputFile, 'utf8')
    const branchMermaid = sliceBetween(
      markdown,
      '<!-- structured-process-demo:branch-one-of-three-demo:mermaid:start -->',
      '<!-- structured-process-demo:branch-one-of-three-demo:mermaid:end -->'
    )
    const branchTable = sliceBetween(
      markdown,
      '<!-- structured-process-demo:branch-two-of-three-demo:html-table:start -->',
      '<!-- structured-process-demo:branch-two-of-three-demo:html-table:end -->'
    )
    const nestedBranchMermaid = sliceBetween(
      markdown,
      '<!-- structured-process-demo:nested-branch-demo:mermaid:start -->',
      '<!-- structured-process-demo:nested-branch-demo:mermaid:end -->'
    )
    const nestedBranchTable = sliceBetween(
      markdown,
      '<!-- structured-process-demo:nested-branch-demo:html-table:start -->',
      '<!-- structured-process-demo:nested-branch-demo:html-table:end -->'
    )
    const structuredStepDescriptionTable = sliceBetween(
      markdown,
      '<!-- structured-process-demo:structured-step-description-demo:html-table:start -->',
      '<!-- structured-process-demo:structured-step-description-demo:html-table:end -->'
    )
    const structuredStepDescriptionResult = sliceBetween(
      markdown,
      '<!-- structured-process-demo:structured-step-description-demo-result:json:start -->',
      '<!-- structured-process-demo:structured-step-description-demo-result:json:end -->'
    )
    const structuredStepDescriptionFlowJson = sliceBetween(
      markdown,
      '<!-- structured-process-demo:structured-step-description-flow-json:json:start -->',
      '<!-- structured-process-demo:structured-step-description-flow-json:json:end -->'
    )
    const coreApiSection = sliceBetween(markdown, '# Core API', '## Flow And Step Execution')

    expect(branchMermaid).toContain('ROUTE:')
    expect(branchMermaid).toContain('branches: expense')
    expect(branchMermaid).toContain('Branch: expense')
    expect(branchMermaid).toContain('EX-1: Handle expense')
    expect(branchMermaid).toContain('Branch: income')
    expect(branchMermaid).toContain('Branch: income\n[skip]')
    expect(branchMermaid).toContain('IN-1: Handle income')
    expect(branchMermaid).toContain('[skip]')
    expect(branchMermaid).toContain('ROUTE:')
    expect(branchMermaid).toContain('branches: expense\n[ok]')
    expect(branchMermaid).toContain('branch_0_end["ROUTE:\nend"]')
    expect(branchMermaid).toContain('branch_0_end --> done')
    expect(branchMermaid).toContain('branch_0_0_step_0 --> branch_0_end')
    expect(branchMermaid).not.toContain('\n  step_0 --> branch_0_end\n')
    expect(branchMermaid).not.toContain('branch_0_result')
    expect(branchTable).toContain('fraud')
    expect(branchTable).toContain('policy')
    expect(branchTable).toContain('FRAUD-1')
    expect(branchTable).toContain('Check fraud')
    expect(branchTable).toContain('POLICY-1')
    expect(branchTable).toContain('Check policy')
    expect(branchTable).toContain('Final ctx:')
    expect(branchTable).toContain('taxChecked')
    expect(branchTable).toContain('Fraud review failed.')
    expect(nestedBranchMermaid).toContain('ROOT-ROUTE:')
    expect(nestedBranchMermaid).toContain('branches: B\n[ok]')
    expect(nestedBranchMermaid).toContain('B-ROUTE:')
    expect(nestedBranchMermaid).toContain('branches: D\n[ok]')
    expect(nestedBranchMermaid).toContain('Branch: D')
    expect(nestedBranchMermaid).toContain('D-1: Handle D')
    expect(nestedBranchMermaid).toContain('branch_0_end["ROOT-ROUTE:\nend"]')
    expect(nestedBranchMermaid).toContain('branch_0_0_step_0_branch_end["B-ROUTE:\nend"]')
    expect(nestedBranchMermaid).toContain('branch_0_0_step_0_branch_0_step_0 --> branch_0_0_step_0_branch_end')
    expect(nestedBranchMermaid).not.toContain('\n  step_0 --> branch_0_end\n')
    expect(nestedBranchMermaid).not.toContain('branch_0_result')
    expect(nestedBranchTable).toContain('ROOT-ROUTE')
    expect(nestedBranchTable).toContain('B-ROUTE')
    expect(nestedBranchTable).toContain('D-1: Handle D')
    expect(nestedBranchTable).toContain('visitedD')
    expect(structuredStepDescriptionTable).toContain('&quot;label&quot;:&quot;Validate amount&quot;')
    expect(structuredStepDescriptionTable).toContain('&quot;label&quot;:&quot;Route review&quot;')
    expect(structuredStepDescriptionResult).toContain('queuedForReview')
    expect(structuredStepDescriptionFlowJson).toContain('&quot;mode&quot;: &quot;sync&quot;')
    expect(structuredStepDescriptionFlowJson).toContain('&quot;fn&quot;: {')
    expect(structuredStepDescriptionFlowJson).toContain('&quot;kind&quot;: &quot;arrow-function&quot;')
    expect(structuredStepDescriptionFlowJson).toContain('&quot;bodyPreview&quot;:')
    expect(markdown).toContain('const autoReviewFlow = createSyncFlow(')
    expect(markdown).toContain('const manualReviewFlow = createSyncFlow(')
    expect(markdown).not.toContain('const autoReviewFlow = createSyncFlow<')
    expect(markdown).not.toContain('const manualReviewFlow = createSyncFlow<')
    expect(coreApiSection).toContain(
      "const validations = createAsyncFlow('IC10', 'Get linked occupancy records', getOccupancies)"
    )
    expect(coreApiSection).toContain("const result = await validations.run({form: {id: '200'}})")
    expect(coreApiSection).toContain('if (!result.ok) {')
  })
})
