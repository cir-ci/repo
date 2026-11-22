import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** The repository root. */
export const ROOT = resolve(import.meta.dirname, '../../../..')

function cssModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssModules(path)
    return entry.name.endsWith('.module.css') ? [path] : []
  })
}

export interface Rule {
  file: string
  selector: string
  declarations: Map<string, string>
}

export const rules: Rule[] = [
  ...cssModules(join(ROOT, 'packages/ui/src')),
  ...cssModules(join(ROOT, 'apps/web/src')),
].flatMap((path) => {
  const source = readFileSync(path, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '')
  const file = relative(ROOT, path)
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const declarations = new Map<string, string>()
    for (const part of match[2]!.split(';')) {
      const colon = part.indexOf(':')
      if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim())
    }
    return { file, selector: match[1]!.trim().replaceAll(/\s+/g, ' '), declarations }
  })
})

export const key = (rule: Rule) => `${rule.file} ${rule.selector}`

/** The rules of one stylesheet, by its path from the repository root ("packages/ui/src/Stack.module.css"). */
export const rulesOf = (file: string): Rule[] => rules.filter((rule) => rule.file === file)

/** What one rule declares, found by its selector in a stylesheet (the whole selector, as written). */
export function declarationsOf(file: string, selector: string): Map<string, string> {
  const found = rulesOf(file).filter((rule) => rule.selector === selector)
  if (found.length !== 1)
    throw new Error(`${file}: expected one rule "${selector}", found ${found.length}`)
  return found[0]!.declarations
}
