import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { writeStructuredProcessExampleMarkdown } from '../demos/updateReadme'

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

    expect(branchMermaid).toContain('ROUTE:')
    expect(branchMermaid).toContain('branches: expense')
    expect(branchMermaid).toContain('Branch: expense')
    expect(branchMermaid).toContain('EX-1: Handle expense')
    expect(branchMermaid).toContain('ROUTE:')
    expect(branchMermaid).toContain('Result: ok')
    expect(branchTable).toContain('fraud')
    expect(branchTable).toContain('FRAUD-1')
    expect(branchTable).toContain('Check fraud')
    expect(branchTable).toContain('Ctx:')
    expect(branchTable).toContain('taxChecked')
    expect(branchTable).toContain('Fraud review failed.')
  })
})
