import { INSTALLATION_ID_RE } from '@circi/core'
import { z } from 'zod'

export const teamParams = z.object({ workspace: z.string(), team: z.string() })
export const hookParams = teamParams.extend({ id: z.string() })

export const settingsBody = z
  .object({
    name: z.string().max(100),
    slug: z.string().max(100),
    defaultBranch: z.string().max(255),
    diffThreshold: z.number(),
    autoApproveDefaultBranch: z.boolean(),
    blockMergeOnChanges: z.boolean(),
    /** null: inherit the workspace's setting. */
    flakyBlocksMerge: z.boolean().nullable(),
    retentionDays: z.number(),
    /** null: no review target. */
    reviewTargetHours: z.number().nullable(),
    staticHostingEnabled: z.boolean(),
  })
  .partial()
  .strict()

export const appearanceBody = z
  .object({
    color: z.string().max(40),
    /** null clears the icon (the tile shows the team's first letter). */
    icon: z.string().max(40).nullable(),
  })
  .partial()
  .strict()

export const githubBody = z.object({
  installationId: z.string().regex(INSTALLATION_ID_RE, 'The installation ID is a number'),
  repoRef: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/name, e.g. acme/web'),
})

export const webhookBody = z.object({
  url: z.string().max(2048),
  events: z.array(z.string()).optional(),
})
