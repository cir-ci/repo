import {
  commitLabelOfVersion,
  consumeSiteToken,
  createSiteSession,
  type Database,
  findSiteByLabel,
  getSiteFile,
  siteSessionValid,
  touchSiteSession,
} from '@circi/db'

/** What an address serves, with who owns it. */
export async function findSite(
  db: Database,
  label: string,
): Promise<findSiteByLabel.Site | undefined> {
  return findSiteByLabel(db, label)
}

/**
 * The token handoff from the dashboard: spends the single-use token for this address and, if it
 * was good, starts a site session. Returns the session id, or `undefined` for a bad token.
 */
export async function openSiteSession(
  db: Database,
  input: { token: string | null; label: string; siteExists: boolean },
): Promise<string | undefined> {
  if (!input.token || !input.siteExists) return undefined
  const { token, label } = input
  return db.transaction(async (tx) => {
    const spent = await consumeSiteToken(tx, token, label)
    return spent ? createSiteSession(tx, { label, ...spent }) : undefined
  })
}

/**
 * Whether a site session still stands (see `siteSessionValid`); when it does, its expiry slides
 * forward, because the cookie lives from the last use.
 */
export async function confirmSiteSession(
  db: Database,
  input: { id: string; label: string; workspaceId: string },
): Promise<boolean> {
  if (!(await siteSessionValid(db, input))) return false
  await db.transaction((tx) => touchSiteSession(tx, input.id))
  return true
}

/**
 * The file a request path serves from a version: the path itself, or its `index.html`; an
 * extension-less path of a single-page app falls back to the entry file.
 */
export async function findSiteFile(
  db: Database,
  input: { versionId: string; entryPath: string; wanted: string; spa: boolean },
) {
  const { versionId, entryPath, wanted } = input
  const candidates = [
    wanted === '' ? entryPath : wanted,
    ...(wanted === '' ? [] : [`${wanted}/index.html`]),
  ]
  let file
  for (const path of candidates) {
    // eslint-disable-next-line no-await-in-loop -- at most two lookups
    file = await getSiteFile(db, versionId, path)
    if (file) break
  }
  if (!file && input.spa && !/\.[A-Za-z0-9]{1,8}$/.test(wanted)) {
    file = await getSiteFile(db, versionId, entryPath)
  }
  return file
}

/** The commit address currently serving a version (for service-worker kinds on a branch address). */
export async function commitAddressOf(
  db: Database,
  versionId: string,
): Promise<string | undefined> {
  return commitLabelOfVersion(db, versionId)
}
