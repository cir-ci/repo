/**
 * Review rules: a glob over snapshot names or the build's name decides who is asked to review.
 * Pure, so the settings preview, `finalizeBuild` and the tests agree on what matches.
 */

export const RULE_KINDS = ['snapshot-name', 'build-name'] as const
export type RuleKind = (typeof RULE_KINDS)[number]

const REGEX_SPECIALS = /[\\^$.*+?()[\]{}|/-]/g

const globCache = new Map<string, RegExp>()

function compile(pattern: string): RegExp {
  const cached = globCache.get(pattern)
  if (cached) return cached
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern.charAt(i)
    if (c === '*') {
      if (pattern.charAt(i + 1) === '*') {
        // `**` crosses `/`; a following `/` is optional so `a/**/b` also matches `a/b`.
        i += 1
        if (pattern.charAt(i + 1) === '/') {
          i += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (c === '?') {
      source += '[^/]'
    } else {
      source += c.replace(REGEX_SPECIALS, '\\$&')
    }
  }
  const re = new RegExp(`^${source}$`, 's')
  if (globCache.size > 500) globCache.clear()
  globCache.set(pattern, re)
  return re
}

/**
 * Whether `name` matches a glob. `*` is any run of characters except `/`, `**` any run at all
 * (`/` included), `?` one character except `/`. The whole name must match, case matters, and
 * there are no character classes or braces: every other character stands for itself. An empty
 * pattern matches only the empty name.
 */
export function globMatches(pattern: string, name: string): boolean {
  return compile(pattern).test(name)
}

export interface ReviewRuleLike {
  kind: RuleKind
  pattern: string
  reviewers: readonly string[]
}

/**
 * The reviewers a build's rules ask, in the order the rules and their reviewers are listed, with
 * nobody twice. A `snapshot-name` rule matches when any of the build's snapshots does; a
 * `build-name` rule matches the build's own name. No match gives an empty list.
 */
export function reviewersForBuild(
  rules: readonly ReviewRuleLike[],
  build: { name: string; snapshotNames: readonly string[] },
): string[] {
  const out = new Set<string>()
  for (const rule of rules) {
    const hit =
      rule.kind === 'build-name'
        ? globMatches(rule.pattern, build.name)
        : build.snapshotNames.some((n) => globMatches(rule.pattern, n))
    if (hit) for (const r of rule.reviewers) out.add(r)
  }
  return [...out]
}
