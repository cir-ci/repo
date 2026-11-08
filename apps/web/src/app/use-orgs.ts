import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { capabilitiesQuery, projectsQuery } from '#features/projects/api.ts'

import { listOrgs, type OrgRef, pickOrg } from './shell-model.ts'

/** The organizations the person can switch between, and the one the shell is about (address, else `remembered`, else first). */
export function useOrgs(remembered: string | undefined): {
  orgs: OrgRef[]
  org: OrgRef | undefined
} {
  const params = useParams({ strict: false })
  const { data: overview } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const orgs = listOrgs(overview?.projects, caps?.manageableOrganizations, params.org)
  return { orgs, org: pickOrg(orgs, params.org, remembered) }
}
