import { ProviderApiError } from '#src/git/provider.ts'

/** The failure a tracker's HTTP answer means: 401 and 403 say the credentials are no good. */
export function trackerError(tracker: string, status: number, detail: string): ProviderApiError {
  return new ProviderApiError(status, `${tracker}: ${status} ${detail}`.trim(), {
    revoked: status === 401 || status === 403,
  })
}
