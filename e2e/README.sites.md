# Static sites in the end-to-end harness

Tests: `e2e/test/sites/sites.browser.e2e.test.ts` (upload, Sites page, sign-in handoff, access, kinds, branch
address, expiry, S3) and `e2e/test/sites/sites-security.e2e.test.ts` (hostile and oversized archives).
Helpers: `e2e/src/clients/sites.ts` (import it directly; it is not re-exported from `index.ts`).

## How the sites host works here

`useStack({ sitesHost: 'sites.localhost' })` sets `STATIC_SITES_HOST=sites.localhost` in the
container. CirCI refuses a sites domain that is the dashboard's host, its parent or child, and
`localhost` is the parent of `*.localhost`, so with `sitesHost` the harness addresses the dashboard
by IP: `PUBLIC_URL=http://127.0.0.1:<random port>` (`stack.url`). Site addresses are then built by
the server as `http://<hash>-<slug>.sites.localhost:<same port>` (scheme and port are the
dashboard's, see `sitesDeps` in `apps/server/src/composition/server-options.ts`). The port matters:
it is in the `Host` header the server matches and in the cookie scope.

- **Chromium** resolves every `*.localhost` name to loopback by itself, so browser tests just open
  the address (the published port is on 127.0.0.1).
- **Node on the host** may not resolve `*.localhost`: `siteRequest(stack, address, path, { cookie })`
  connects to `127.0.0.1:<port>` and sets `Host` itself, never following redirects.
- **The sign-in handoff** in HTTP form: `siteCookieFor(stack, session, address)` asks
  `POST /api/site-handoff` as a signed-in dashboard session and follows the one-minute token to the
  site, returning the site's `circi_site=...` cookie.
- **Cookies**: the dashboard's cookies live on `127.0.0.1`, a site's on its own host. Over plain
  http the site cookie is `circi_site` (`__Host-circi_site` only over https).
- **Hosting is per project**: `PATCH /api/projects/<workspace>/<project>/settings
  { staticHostingEnabled: true }` before uploading (until then the upload is refused with a
  message saying so).

## Helpers

- `makeSiteDir({ 'index.html': '...', 'assets/app.js': '...' })`: a scratch folder to upload (delete
  it afterwards).
- `uploadSiteCli({ stack, token, repo, dir, name, kind, spa, storybook, env })`: the real built CLI
  (`circi site upload` / `circi storybook upload`) in a `Repo` checkout; returns exit code, output
  and the printed `commitAddress` / `branchAddress`.
- `tgzOf([{ name, type, content, linkname, declaredSize }])` + `postSiteArchive(stack, token, body,
  query)`: hand-made tar.gz with exactly the entries given (traversal, absolute paths, symlinks,
  hard links, devices, FIFOs, NULs, duplicates) posted to the real `POST /v1/sites`.

## Notes

- `STATIC_SITES_MAX_MB` is at least 1; the security file runs with 1 so a ~1.6 MB random file
  exceeds it.
- Expiry: retention removes site versions and non-default-branch addresses older than the
  project's retention days (`circi admin storage gc --grace-hours 0`, after back-dating rows with
  `stack.sql`). Rows are deleted, so an expired address answers like one that never existed.
- Containment is checked inside the container: a canary file and an `find -newer` marker outside
  `/var/lib/circi/files`.
