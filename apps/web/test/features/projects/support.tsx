/** A build as the projects API lists it (changes detected, awaiting review). */
export function build(number: number, over: Record<string, unknown> = {}) {
  return {
    id: `b${number}`,
    number,
    name: 'default',
    commitSha: `abcdef${number}1234567`,
    branch: 'main',
    prNumber: null,
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
    createdAt: new Date().toISOString(),
    counts: { added: 0, removed: 0, changed: 2, unchanged: 3, failed: 0, total: 5 },
    ...over,
  }
}
