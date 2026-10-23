import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('checks toolbar column ID contracts with the TypeScript compiler', () => {
  const configPath = resolve('tsconfig.json')
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  expect(error).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, resolve('.'))
  const fixture = resolve(
    'src/components/data-table/data-table-advanced-toolbar.test-d.tsx',
  )
  const program = ts.createProgram([fixture], parsed.options)
  // Check the contract fixture independently of existing source diagnostics.
  const diagnostics = [
    ...parsed.errors,
    ...ts
      .getPreEmitDiagnostics(program)
      .filter((issue) => !issue.file || issue.file.fileName === fixture),
  ]
  expect(
    diagnostics.map((issue) =>
      ts.flattenDiagnosticMessageText(issue.messageText, '\n'),
    ),
  ).toEqual([])
}, 30_000)
