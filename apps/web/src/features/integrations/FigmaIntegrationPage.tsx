import type { Figma } from '@circi/api'
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ListRow,
  SectionHeader,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import { useRemoveIntegration } from './api.ts'
import {
  autoLinkSummary,
  figmaLinksQuery,
  figmaPageQuery,
  isFileReference,
  isFrameAddress,
  linkedLabel,
  useFigmaFile,
  useFigmaLinks,
} from './figma-api.ts'
import { ProviderLogo } from './logos.tsx'

import styles from './Figma.module.css'

/**
 * The Figma integration (the canvas shows the connected account and the file per project; the
 * links table, "Link automatically" and the add-link form are undesigned and follow the GitHub
 * page's pattern): which Figma file each project is designed in, and which frame each snapshot is
 * linked to. A snapshot links by name pattern, either found by CirCI ("auto") or added by hand
 * ("manual"); the frame then shows in the build review.
 */
export function FigmaIntegrationPage() {
  const { org } = useParams({ from: '/organizations/$org/settings/integrations/figma' })
  useDocumentTitle('Figma', 'Integrations', org)
  const navigate = useNavigate()
  const { data, error, refetch } = useQuery(figmaPageQuery(org))
  const remove = useRemoveIntegration(org)
  const [removing, setRemoving] = useState(false)

  return (
    <Frame
      crumbs={[org, 'Integrations', 'Figma']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
      readOnlyNote={data && !data.canManage && 'Only owners and admins can change Figma settings.'}
    >
      {data ? (
        <section className={styles.page}>
          <div className={styles.head}>
            <ProviderLogo kind="figma" size={40} />
            <div className={styles.headText}>
              <SectionHeader
                title="Figma"
                description="Link snapshots to the frames they implement. The frame shows in the build review, next to the snapshot."
              />
              {data.account ? (
                <Text variant="small" tone="secondary">
                  {data.account.name}
                </Text>
              ) : null}
            </div>
            {data.account ? (
              <>
                {data.account.needsAttention ? (
                  <Badge tone="state" state="rejected" shape="tag">
                    Needs attention
                  </Badge>
                ) : (
                  <Badge tone="state" state="approved" shape="tag">
                    Connected
                  </Badge>
                )}
                {data.canManage ? (
                  <Button variant="danger" onClick={() => setRemoving(true)}>
                    Remove
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>

          {!data.account ? (
            <EmptyState title="Figma isn’t connected">
              <Link to="/organizations/$org/settings/integrations" params={{ org }}>
                Add it from Integrations
              </Link>{' '}
              first.
            </EmptyState>
          ) : (
            <>
              {data.account.needsAttention ? (
                <Banner tone="danger" title="CirCI can’t reach Figma:">
                  {data.account.attentionReason ??
                    'the access token was rejected. Remove Figma and connect it again with a new token.'}
                </Banner>
              ) : null}
              {data.projects.length === 0 ? (
                <EmptyState title="No projects yet" />
              ) : (
                <ul className={styles.projects} aria-label="Figma files by project">
                  {data.projects.map((p) => (
                    <li key={p.slug}>
                      <ProjectFile org={org} project={p} canManage={data.canManage} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title="Remove Figma?"
            description="Projects stop using their Figma files and the automatic links are deleted. You can connect it again later."
            confirmLabel="Remove"
            loading={remove.isPending}
            onConfirm={() => {
              if (!data.account) return
              remove.mutate(
                { source: 'integration', id: data.account.id },
                {
                  onSuccess: () => {
                    setRemoving(false)
                    void navigate({
                      to: '/organizations/$org/settings/integrations',
                      params: { org },
                    })
                  },
                },
              )
            }}
          />
        </section>
      ) : null}
    </Frame>
  )
}

function ProjectFile(props: { org: string; project: Figma.Project; canManage: boolean }) {
  const { org, project, canManage } = props
  const file = useFigmaFile(org)
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isFileReference(address)) return
    file.set.mutate(
      { project: project.slug, file: address },
      {
        onSuccess: () => {
          setEditing(false)
          setAddress('')
        },
      },
    )
  }

  return (
    <div className={styles.project} role="group" aria-label={project.name}>
      <ListRow density="two-line">
        <div className={styles.fileRow}>
          <div className={styles.fileName}>
            <Text>{project.name}</Text>
            {project.fileKey && project.fileUrl ? (
              <Text variant="small" tone="secondary">
                <a href={project.fileUrl} target="_blank" rel="noreferrer">
                  {project.fileName ?? project.fileKey}
                </a>
                {' · '}
                {linkedLabel(project)}
              </Text>
            ) : (
              <Text variant="small" tone="secondary">
                No file: this project doesn’t use Figma.
              </Text>
            )}
          </div>
          {canManage && !editing ? (
            <Button onClick={() => setEditing(true)}>
              {project.fileKey ? 'Change' : 'Choose file'}
            </Button>
          ) : null}
        </div>
      </ListRow>
      {editing ? (
        <form
          onSubmit={submit}
          noValidate
          className={styles.addRow}
          aria-label={`Figma file of ${project.name}`}
        >
          <TextField
            className={styles.grow}
            label={`${project.name} Figma file`}
            placeholder="https://www.figma.com/design/…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            description="The file’s address in Figma, or its file key."
            {...(address && !isFileReference(address)
              ? { error: 'That is not a Figma file address' }
              : {})}
          />
          <Button
            type="submit"
            variant="primary"
            loading={file.set.isPending}
            disabled={!isFileReference(address)}
          >
            Save file
          </Button>
          {project.fileKey ? (
            <Button
              variant="danger"
              loading={file.clear.isPending}
              onClick={() =>
                file.clear.mutate(project.slug, {
                  onSuccess: () => setEditing(false),
                })
              }
            >
              Remove file
            </Button>
          ) : null}
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : null}
      {file.set.error ? <Banner tone="danger">{file.set.error.message}</Banner> : null}
      {file.clear.error ? <Banner tone="danger">{file.clear.error.message}</Banner> : null}
      {project.fileKey || project.linked > 0 ? (
        <ProjectLinks org={org} project={project} canManage={canManage} />
      ) : null}
    </div>
  )
}

function ProjectLinks(props: { org: string; project: Figma.Project; canManage: boolean }) {
  const { org, project, canManage } = props
  const { data, error } = useQuery(figmaLinksQuery(org, project.slug))
  const actions = useFigmaLinks(org)
  const [pattern, setPattern] = useState('')
  const [url, setUrl] = useState('')
  const valid = pattern.trim() !== '' && isFrameAddress(url)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!valid) return
    actions.create.mutate(
      { project: project.slug, pattern, url },
      {
        onSuccess: () => {
          setPattern('')
          setUrl('')
        },
      },
    )
  }

  return (
    <div className={styles.links}>
      <div className={styles.linksHead}>
        <Text variant="small" tone="secondary">
          Frame links
        </Text>
        {canManage && project.fileKey ? (
          <Button
            loading={actions.auto.isPending}
            onClick={() => actions.auto.mutate(project.slug)}
            aria-label={`Link ${project.name} automatically`}
          >
            Link automatically
          </Button>
        ) : null}
      </div>
      {actions.auto.data ? <Banner>{autoLinkSummary(actions.auto.data)}</Banner> : null}
      {actions.auto.error ? <Banner tone="danger">{actions.auto.error.message}</Banner> : null}
      {actions.remove.error ? <Banner tone="danger">{actions.remove.error.message}</Banner> : null}
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {data && data.links.length === 0 ? (
        <Text variant="small" tone="secondary">
          No links yet. Link automatically matches frames to snapshots with the same name.
        </Text>
      ) : null}
      {data && data.links.length > 0 ? (
        <table className={styles.table} aria-label={`${project.name} frame links`}>
          <thead>
            <tr>
              <th scope="col">Snapshot name</th>
              <th scope="col">Frame</th>
              <th scope="col">How</th>
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.links.map((l) => (
              <tr key={l.id}>
                <td>
                  <Text variant="mono">{l.snapshotPattern}</Text>
                </td>
                <td>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.frameName ?? l.nodeId}
                  </a>
                </td>
                <td>
                  <Badge shape="tag">{l.source === 'auto' ? 'Auto' : 'Manual'}</Badge>
                </td>
                <td className={styles.actions}>
                  {canManage ? (
                    <Button
                      variant="danger"
                      onClick={() => actions.remove.mutate({ project: project.slug, id: l.id })}
                      aria-label={`Remove link ${l.snapshotPattern}`}
                    >
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {canManage ? (
        <form
          onSubmit={submit}
          noValidate
          className={styles.addRow}
          aria-label={`Add a frame link to ${project.name}`}
        >
          <TextField
            className={styles.grow}
            label={`${project.name} snapshot name`}
            placeholder="checkout/*"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            description="A name, or a pattern: * matches within a folder, ** across folders."
          />
          <TextField
            className={styles.grow}
            label={`${project.name} frame address`}
            placeholder="https://www.figma.com/design/…?node-id=12-34"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            description="In Figma, select the frame and choose Copy link to selection."
            {...(url && !isFrameAddress(url)
              ? { error: 'Paste the address of a frame, with its node-id' }
              : {})}
          />
          <Button
            type="submit"
            variant="primary"
            loading={actions.create.isPending}
            disabled={!valid}
          >
            Add link
          </Button>
        </form>
      ) : null}
      {actions.create.error ? <Banner tone="danger">{actions.create.error.message}</Banner> : null}
    </div>
  )
}
