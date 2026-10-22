import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const modules = import.meta.glob<string>(
  [
    '/src/components/**/*.{ts,tsx}',
    '/src/hooks/**/*.{ts,tsx}',
    '/src/lib/**/*.{ts,tsx}',
    '/src/config/**/*.{ts,tsx}',
    '!/src/**/*.test.{ts,tsx}',
  ],
  { eager: true, query: '?raw', import: 'default' },
)

describe('shared module boundaries', () => {
  it('keeps feature, application, and route dependencies out of reusable modules', () => {
    const violations: string[] = []
    for (const [file, source] of Object.entries(modules)) {
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      )
      const check = (specifier: ts.Node | undefined) => {
        if (!specifier || !ts.isStringLiteralLike(specifier)) return
        const target =
          specifier.text.startsWith('@/') || specifier.text.startsWith('#/')
            ? resolve('/src', specifier.text.slice(2))
            : specifier.text.startsWith('.')
              ? resolve(dirname(file), specifier.text)
              : specifier.text
        if (/^\/src\/(features|app|routes)(\/|$)/.test(target)) {
          violations.push(`${file} imports ${specifier.text}`)
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          check(node.moduleSpecifier)
        } else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          check(node.arguments[0])
        } else if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument)
        ) {
          check(node.argument.literal)
        } else if (ts.isExternalModuleReference(node)) {
          check(node.expression)
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(Object.keys(modules).length).toBeGreaterThan(0)
    expect(violations).toEqual([])
  })
})
