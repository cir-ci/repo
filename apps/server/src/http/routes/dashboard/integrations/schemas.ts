import { z } from 'zod'

export const kindParams = z.object({ workspace: z.string(), kind: z.string() })
export const idParams = z.object({ workspace: z.string(), id: z.uuid() })
export const mappingParams = idParams.extend({ team: z.string() })
export const callbackParams = z.object({ kind: z.string() })
export const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})
export const linkParams = mappingParams.extend({ linkId: z.string() })
export const linkBody = z.strictObject({ values: z.record(z.string(), z.string()) })
export const mappingBody = z.strictObject({
  ref: z.string().trim().min(1).max(1000),
  name: z.string().trim().min(1).max(200).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})

export const setupQuery = z.object({
  installation_id: z.string().optional(),
  setup_action: z.string().optional(),
  state: z.string().optional(),
})

export const callbackPath = (kind: string) => `/integrations/${kind}/callback`
