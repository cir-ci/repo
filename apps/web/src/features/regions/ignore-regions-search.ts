/** The old editor address's search: `?name=` picked the screenshot; it now redirects to that baseline page. */
export const parseIgnoreRegionsSearch = (search: Record<string, unknown>): { name?: string } => {
  const name = search['name']
  return typeof name === 'string' && name ? { name } : {}
}
