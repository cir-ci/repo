import type { Site } from '@circi/api'
import { Badge, Banner, Button, Heading, Link, Text, TextField, useAnnounce } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { useCustomDomain } from './api.ts'

import styles from './CustomDomainSection.module.css'

/**
 * One site's custom domain: a domain that always opens the team's default branch version. Shows
 * whether DNS points at the server yet, and the record to add until it does. Owners and admins
 * can change it; everyone else sees it.
 */
export function CustomDomainSection({
  workspace,
  team,
  site,
  dnsTarget,
  canManage,
}: CustomDomainSection.Props) {
  const domain = site.customDomain
  const mutations = useCustomDomain(workspace, team, site.slug)
  const announce = useAnnounce()
  const [editing, setEditing] = useState(false)
  const [lastCheck, setLastCheck] = useState<Site.DomainCheck | null>(null)

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = new FormData(e.currentTarget).get('domain')
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) return
    mutations.set.mutate(value, {
      onSuccess: () => {
        setEditing(false)
        setLastCheck(null)
        announce('Custom domain saved')
      },
    })
  }

  function check() {
    mutations.verify.mutate(undefined, {
      onSuccess: (result) => {
        setLastCheck(result)
        announce(result.verified ? 'Domain verified' : 'Domain not verified yet')
      },
    })
  }

  const error = mutations.set.error ?? mutations.verify.error ?? mutations.remove.error
  const showForm = canManage && (editing || !domain)

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <Heading level="heading">Custom domain</Heading>
        <Text as="p" variant="small" tone="secondary">
          Opens the default branch’s version of {site.name} on a domain of your own.
        </Text>
      </div>

      {domain && !showForm ? (
        <div className={styles.current}>
          <Text as="div" variant="mono" truncate>
            {domain.verified ? (
              <Link href={domain.address} target="_blank" rel="noreferrer">
                {domain.domain}
              </Link>
            ) : (
              domain.domain
            )}
          </Text>
          <Badge tone="state" state={domain.verified ? 'approved' : 'review'}>
            {domain.verified ? 'Verified' : 'Not verified'}
          </Badge>
          {canManage ? (
            <div className={styles.actions}>
              {domain.verified ? null : (
                <Button size="sm" loading={mutations.verify.isPending} onClick={check}>
                  Check DNS
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(true)}>
                Change
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={mutations.remove.isPending}
                aria-label={`Remove ${domain.domain}`}
                onClick={() =>
                  mutations.remove.mutate(undefined, {
                    onSuccess: () => {
                      setLastCheck(null)
                      announce('Custom domain removed')
                    },
                  })
                }
              >
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <form className={styles.form} onSubmit={save}>
          <TextField
            label="Domain"
            name="domain"
            defaultValue={domain?.domain ?? ''}
            placeholder="storybook.acme.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={mutations.set.isPending}>
              Save domain
            </Button>
            {domain ? (
              <Button
                onClick={() => {
                  mutations.set.reset()
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {domain && !domain.verified && dnsTarget ? (
        <div className={styles.dns}>
          <Text as="p" variant="small" tone="secondary">
            Add this DNS record at your domain’s provider, then check DNS. The domain is served, and
            its certificate issued, once it points here.
          </Text>
          <dl className={styles.record} aria-label="DNS record">
            <div>
              <dt>Type</dt>
              <dd>CNAME</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{domain.domain}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{dnsTarget}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {lastCheck && !lastCheck.verified && lastCheck.error ? (
        <Banner tone="warning">{lastCheck.error}</Banner>
      ) : null}
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
    </div>
  )
}

export namespace CustomDomainSection {
  export interface Props {
    workspace: string
    team: string
    site: Pick<Site.Listing, 'slug' | 'name' | 'customDomain'>
    /** What the CNAME points at (`Site.List.dnsTarget`). */
    dnsTarget: string | null
    canManage: boolean
  }
}
