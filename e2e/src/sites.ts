import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

import type { Session } from './admin.ts'
import { GIT_ENV, type Repo } from './git-repo.ts'
import { E2E_ROOT } from './paths.ts'
import type { Stack } from './stack.ts'
import { ensureCliBuilt, runCli } from './upload.ts'

/**
 * Helpers for the static-sites tests (see e2e/README.sites.md). Additive: nothing here changes
 * how the other helpers behave.
 */

/** Writes `files` (relative path -> text or bytes) into a new scratch directory; returns it. */
export async function makeSiteDir(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'circi-e2e-site-'))
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return dir
}

export interface SiteCliOptions {
  stack: Pick<Stack, 'url'>
  token: string
  /** The checkout the CLI runs in (it reads the commit and branch from git). */
  repo: Repo
  dir: string
  name?: string
  kind?: string
  spa?: boolean
  /** Use `circi storybook upload` instead of `circi site upload`. */
  storybook?: boolean
  env?: Record<string, string>
}

export interface SiteCliRun {
  exitCode: number
  stdout: string
  stderr: string
  /** `commit:` and `branch:` addresses the CLI printed, when it succeeded. */
  commitAddress: string | undefined
  branchAddress: string | undefined
}

/** `circi site upload <dir>` (the real built CLI) from inside the repo, as CI would run it. */
export async function uploadSiteCli(options: SiteCliOptions): Promise<SiteCliRun> {
  await ensureCliBuilt()
  const base: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
    const value = process.env[key]
    if (value) base[key] = value
  }
  const args = [
    ...(options.storybook ? ['storybook', 'upload'] : ['site', 'upload']),
    options.dir,
    ...(options.name ? ['--name', options.name] : []),
    ...(options.kind ? ['--kind', options.kind] : []),
    ...(options.spa ? ['--spa'] : []),
  ]
  const out = await runCli(args, {
    cwd: options.repo.dir,
    env: {
      ...base,
      ...GIT_ENV,
      CIRCI_TOKEN: options.token,
      CIRCI_API_URL: options.stack.url,
      NODE_OPTIONS: `--import ${join(E2E_ROOT, 'src', 'dns-preload.ts')}`,
      ...options.env,
    },
  })
  const find = (label: string) => new RegExp(`^\\s*${label}:\\s+(\\S+)`, 'm').exec(out.stdout)?.[1]
  return { ...out, commitAddress: find('commit'), branchAddress: find('branch') }
}

/** Raw `POST /v1/sites` with an arbitrary body: for archives the CLI would never produce. */
export async function postSiteArchive(
  stack: Pick<Stack, 'url'>,
  token: string,
  body: Buffer,
  query: Record<string, string> = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const q = new URLSearchParams({
    name: 'hostile',
    commit: 'abcdef0123456789abcdef0123456789abcdef01',
    ...query,
  })
  const res = await fetch(`${stack.url}/v1/sites?${q.toString()}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
    body: new Uint8Array(body),
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // keep the text
  }
  return { status: res.status, body: parsed, text }
}

export interface SiteResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  text: string
}

/**
 * A GET/HEAD to a site address (`http://<label>.<sites host>:<port>`) without relying on the
 * host's resolver: connects to the published loopback port and sets `Host` itself, as a browser
 * would after resolving `*.localhost`. Never follows redirects.
 */
export function siteRequest(
  stack: Pick<Stack, 'ports'>,
  address: string,
  path = '/',
  options: {
    method?: string
    cookie?: string
    headers?: Record<string, string>
    host?: string
  } = {},
): Promise<SiteResponse> {
  const url = new URL(address)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: stack.ports.http,
        path,
        method: options.method ?? 'GET',
        headers: {
          host: options.host ?? url.host,
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            text: body.toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** The `Set-Cookie` header(s) of a response as `name=value` pairs joined for a `Cookie` header. */
export function cookieFrom(res: SiteResponse): string {
  const set = res.headers['set-cookie']
  const lines = Array.isArray(set) ? set : set ? [set] : []
  return lines
    .map((l) => l.split(';')[0] ?? '')
    .filter((p) => !p.endsWith('='))
    .join('; ')
}

/** `label` of `http://<label>.sites.localhost:1234`. */
export const labelOfAddress = (address: string): string =>
  new URL(address).hostname.split('.')[0] ?? ''

/**
 * The whole sign-in handoff over HTTP, as the browser does it: a signed-in dashboard session asks
 * for access to `address` and follows the one-minute token to the site, which sets its cookie.
 * Returns the site cookie (`circi_site=...`) and the token URL (single-use: opening it again
 * does not sign anyone in).
 */
export async function siteCookieFor(
  stack: Pick<Stack, 'ports'>,
  session: Pick<Session, 'request'>,
  address: string,
  returnPath = '/',
): Promise<{ cookie: string; tokenUrl: string; status: number }> {
  const label = labelOfAddress(address)
  const res = await session.request<{ url: string }>('POST', '/api/site-handoff', {
    label,
    returnPath,
  })
  if (res.status !== 200) return { cookie: '', tokenUrl: '', status: res.status }
  const u = new URL(res.body.url)
  const landed = await siteRequest(stack, address, `${u.pathname}${u.search}`)
  return { cookie: cookieFrom(landed), tokenUrl: res.body.url, status: landed.status }
}

// ---- hand-made tar archives --------------------------------------------------------------------

export interface TarEntry {
  /** The raw name, written as given (NULs, `..` and absolute paths included). */
  name: string
  /** `0` file (default), `1` hard link, `2` symlink, `3` char device, `4` block device, `5` dir, `6` FIFO. */
  type?: '0' | '1' | '2' | '3' | '4' | '5' | '6'
  content?: string | Buffer
  linkname?: string
  /** Declare this size in the header instead of the content's length. */
  declaredSize?: number
}

function field(value: string | Buffer, length: number): Buffer {
  const b = Buffer.alloc(length)
  Buffer.from(value).copy(b, 0, 0, length)
  return b
}

function octal(n: number, length: number): Buffer {
  return field(`${n.toString(8).padStart(length - 1, '0')}\0`, length)
}

/** A ustar archive with exactly the entries given: no safety checks, that is the point. */
export function tarOf(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    const content = e.content === undefined ? Buffer.alloc(0) : Buffer.from(e.content)
    const type = e.type ?? '0'
    const header = Buffer.alloc(512)
    field(e.name, 100).copy(header, 0)
    octal(type === '5' ? 0o755 : 0o644, 8).copy(header, 100)
    octal(0, 8).copy(header, 108)
    octal(0, 8).copy(header, 116)
    const size = e.declaredSize ?? (type === '0' ? content.length : 0)
    octal(size, 12).copy(header, 124)
    octal(0, 12).copy(header, 136)
    header.fill(0x20, 148, 156)
    header.write(type, 156, 'latin1')
    field(e.linkname ?? '', 100).copy(header, 157)
    header.write('ustar\0', 257, 'latin1')
    header.write('00', 263, 'latin1')
    const sum = header.reduce((a, b) => a + b, 0)
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1')
    parts.push(header)
    if (type === '0' && e.declaredSize === undefined) {
      parts.push(content)
      const pad = (512 - (content.length % 512)) % 512
      if (pad) parts.push(Buffer.alloc(pad))
    }
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

/** `tarOf(entries)` gzipped, ready for `postSiteArchive`. */
export const tgzOf = (entries: TarEntry[]): Buffer => gzipSync(tarOf(entries))
