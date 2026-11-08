/** The ignore regions page's address: `?name=` picks the screenshot (Triage links here). */
export const parseIgnoreRegionsSearch = (search: Record<string, unknown>): { name?: string } => {
  const name = search['name']
  return typeof name === 'string' && name ? { name } : {}
}
