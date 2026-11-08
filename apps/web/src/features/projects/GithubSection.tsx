import type { Project } from '@circi/api'
import { Banner, Button, SectionHeader, Text, TextField } from '@circi/ui'
import { type FormEvent } from 'react'

import { useGithubLink } from './api.ts'

import styles from './SettingsSection.module.css'

export function GithubLink(props: GithubLink.Props) {
  const { save, remove } = useGithubLink(props.org, props.project)
  const link = props.github.link
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => {
      const v = form.get(k)
      return typeof v === 'string' ? v.trim() : ''
    }
    save.mutate({ repoRef: text('repoRef'), installationId: text('installationId') })
  }
  return (
    <section className={styles['section']}>
      <SectionHeader
        divided
        title="GitHub"
        description={
          <>
            Builds show up on the pull request as a check with Approve and Reject buttons, and as
            one summary comment. The GitHub App’s webhook address is{' '}
            <Text as="code" variant="mono">
              {props.github.webhookUrl}
            </Text>
            .
          </>
        }
      />
      {link ? (
        <Banner tone="success">
          Reporting to <strong>{link.repoRef}</strong> (installation {link.installationId}).
        </Banner>
      ) : null}
      {props.canManage ? (
        <form onSubmit={submit} noValidate className={styles['fields']}>
          <TextField
            name="repoRef"
            label="Repository"
            placeholder="acme/web"
            defaultValue={link?.repoRef ?? ''}
            required
          />
          <TextField
            name="installationId"
            label="GitHub App installation id"
            defaultValue={link?.installationId ?? ''}
            required
            description="The number at the end of the installation’s settings address on GitHub."
          />
          {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
          {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
          <div className={styles['actions']}>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {link ? 'Update link' : 'Link repository'}
            </Button>
            {link ? (
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Unlink
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  )
}

export namespace GithubLink {
  export interface Props {
    org: string
    project: string
    github: { webhookUrl: string; link: Project.GithubLink | null }
    canManage: boolean
  }
}
