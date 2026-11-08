// Preloaded into the host-run `circi` CLI (`node --import`): host-run processes can't resolve
// `host.docker.internal` on every platform (Docker Desktop adds it, Linux doesn't), but the
// stack's presigned S3 upload URLs carry that name. Map it to loopback, where LocalStack's
// published port is.
import dns from 'node:dns'

const original = dns.lookup
const mapped = (hostname: unknown) => (hostname === 'host.docker.internal' ? '127.0.0.1' : hostname)

dns.lookup = ((hostname: string, ...rest: unknown[]) =>
  (original as (...args: unknown[]) => unknown)(mapped(hostname), ...rest)) as typeof dns.lookup
