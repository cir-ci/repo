import {
  Banner,
  Button,
  ConfirmDialog,
  Delayed,
  ListRow,
  ListSkeleton,
  SectionHeader,
  StatusChip,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { domainsQuery, useDomainActions } from './api.ts'
import { validateDomain } from './model.ts'

import styles from './EmailDomains.module.css'

/** Email domains this organization claims: people signing in with a code on one join as members. */
export function EmailDomains({ org }: EmailDomains.Props) {
  const { data, error, refetch } = useQuery(domainsQuery(org))
  const { add, verify, remove } = useDomainActions(org)
  const announce = useAnnounce()
  const [checked, setChecked] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [problem, setProblem] = useState<string>()
  const [removing, setRemoving] = useState<{ id: string; domain: string } | null>(null)
  const failure = add.error ?? verify.error ?? remove.error

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = domain.trim()
    const problems = validateDomain(value)
    setProblem(problems.domain)
    if (problems.domain) return
    await add.mutateAsync(value).then(
      () => {
        setDomain('')
        announce(`Domain ${value} added`)
      },
      () => {},
    )
  }

  return (
    <section className={styles['root']}>
      <SectionHeader
        title="Email domains"
        description="Once a domain is verified, anyone who signs in with an emailed code on an address at that domain joins this organization as a member, with no invitation."
      />
      {error ? (
        <Banner
          tone="danger"
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        >
          Couldn’t load the email domains: {error.message}
        </Banner>
      ) : !data ? (
        <Delayed>
          <ListSkeleton rows={2} />
        </Delayed>
      ) : data.domains.length > 0 ? (
        <div className={styles['list']}>
          {data.domains.map((d) => (
            <ListRow key={d.id}>
              <div className={styles['row']}>
                <div className={styles['domain']}>
                  <Text>{d.domain}</Text>
                  {d.verified ? null : (
                    <>
                      <Text variant="small" tone="secondary">
                        Add this DNS TXT record, then check:
                      </Text>
                      <Text as="code" variant="mono" className={styles['record']}>
                        {d.dnsName} TXT {d.dnsValue}
                      </Text>
                      <div className={styles['check']}>
                        <Button
                          size="sm"
                          loading={verify.isPending && verify.variables === d.id}
                          disabled={verify.isPending}
                          onClick={() =>
                            verify.mutate(d.id, {
                              onSuccess: (r) => {
                                setChecked(r.verified ? null : d.id)
                                if (r.verified) announce(`${d.domain} is verified`)
                              },
                            })
                          }
                        >
                          Check now
                        </Button>
                        {checked === d.id ? (
                          <Text variant="small" tone="secondary">
                            Not found yet. DNS can take a few minutes to spread.
                          </Text>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
                <div className={styles['trailing']}>
                  <StatusChip status={d.verified ? 'approved' : 'neutral'}>
                    {d.verified ? 'Verified' : 'Not verified'}
                  </StatusChip>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Remove ${d.domain}`}
                    onClick={() => setRemoving({ id: d.id, domain: d.domain })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </ListRow>
          ))}
        </div>
      ) : null}
      <form onSubmit={(e) => void submit(e)} noValidate className={styles['form']}>
        <TextField
          className={styles['field']}
          name="domain"
          label="Domain"
          placeholder="example.com"
          required
          value={domain}
          error={problem}
          onChange={(e) => {
            setDomain(e.target.value)
            setProblem(undefined)
          }}
        />
        <Button type="submit" loading={add.isPending} className={styles['submit']}>
          Add domain
        </Button>
      </form>
      {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.domain ?? 'this domain'}?`}
        description="People with an address at this domain will no longer join this organization when they sign in with a code. Members who already joined stay."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) {
            remove.mutate(removing.id, {
              onSuccess: () => announce(`Domain ${removing.domain} removed`),
              onSettled: () => setRemoving(null),
            })
          }
        }}
      />
    </section>
  )
}

export namespace EmailDomains {
  export interface Props {
    org: string
  }
}
