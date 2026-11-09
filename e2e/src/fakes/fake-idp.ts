import { fakeIdp, type FakeIdp } from '@circi/testing/hosts'

export type { FakeIdp }
export type Identity = FakeIdp.Identity

/**
 * The shared OpenID provider (`@circi/testing/hosts`), reachable from the circi container and from
 * the browser: the issuer host is `host.docker.internal` unless `options.host` says otherwise.
 */
export function startFakeIdp(clientId: string, options: FakeIdp.Options = {}): Promise<FakeIdp> {
  return fakeIdp(clientId, { ...options, host: options.host ?? 'host.docker.internal' })
}
