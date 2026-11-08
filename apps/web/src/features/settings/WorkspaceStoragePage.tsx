import {
  Banner,
  Button,
  EmptyState,
  SectionHeader,
  TeamTile,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { useSaveWorkspaceSettings } from '#features/members/api.ts'
import { isTeamIconName } from '#features/teams/appearance.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import {
  dayCount,
  fileCount,
  formatBytes,
  kindRows,
  storageQuery,
  teamRows,
  workspaceGeneralQuery,
} from './api.ts'
import { Box, BoxRow } from './Box.tsx'
import { Frame } from './Frame.tsx'
import { retentionDirty, retentionProblem } from './model.ts'

import styles from './Settings.module.css'

const NOT_ALLOWED = 'Only owners and admins can change retention.'

/** What the workspace's builds and sites take up, by kind and by team, and its default retention. */
export function WorkspaceStoragePage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/storage' })
  useDocumentTitle('Storage and retention', workspace)
  const { data, error, refetch } = useQuery(storageQuery(workspace))
  const general = useQuery(workspaceGeneralQuery(workspace))

  return (
    <Frame
      crumbs={[general.data?.name ?? workspace, 'Settings', 'Storage and retention']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn’t exist"
      readOnlyNote={data && !data.canManage ? NOT_ALLOWED : false}
    >
      {data ? (
        <>
          <section className={styles.section} aria-labelledby="use">
            <SectionHeader
              title={
                <>
                  <span id="use">Storage used</span>{' '}
                  <Text tone="secondary">{formatBytes(data.totalBytes)}</Text>
                </>
              }
              description={`${fileCount(data.totalFiles)}. Identical files are stored once, across builds and teams, so these add up to more than the total.`}
            />
            <Box label="Storage by kind">
              {kindRows(data).map((k) => (
                <BoxRow
                  key={k.kind}
                  title={k.label}
                  help={
                    k.versions === undefined
                      ? fileCount(k.files)
                      : `${fileCount(k.files)}, ${k.versions} ${k.versions === 1 ? 'version' : 'versions'}`
                  }
                >
                  <span className={styles.barTrack} aria-hidden="true">
                    <span
                      className={styles.barFill}
                      style={{ display: 'block', width: `${k.share * 100}%` }}
                    />
                  </span>
                  <Text className={styles.num}>{formatBytes(k.bytes)}</Text>
                </BoxRow>
              ))}
            </Box>
          </section>

          <section className={styles.section} aria-labelledby="by-team">
            <SectionHeader
              title={<span id="by-team">By team</span>}
              description="What each team’s builds and sites refer to."
            />
            {data.teams.length === 0 ? (
              <EmptyState title="Nothing stored yet">
                Upload a build to see its size here.
              </EmptyState>
            ) : (
              <Box label="Storage by team">
                {teamRows(data).map((t) => (
                  <BoxRow key={t.slug}>
                    <Link
                      to="/$workspace/$team/settings"
                      params={{ workspace, team: t.slug }}
                      className={styles.teamLink}
                    >
                      <TeamTile
                        name={t.name}
                        color={t.color}
                        size={24}
                        {...(isTeamIconName(t.icon) ? { icon: t.icon } : {})}
                      />
                      <Text>{t.name}</Text>
                    </Link>
                    <Text variant="small" tone="tertiary">
                      {dayCount(t.retentionDays)}
                    </Text>
                    <span className={styles.barTrack} aria-hidden="true">
                      <span
                        className={styles.barFill}
                        style={{ display: 'block', width: `${Math.max(t.share * 100, 1)}%` }}
                      />
                    </span>
                    <Text className={styles.num}>{formatBytes(t.bytes)}</Text>
                  </BoxRow>
                ))}
              </Box>
            )}
          </section>

          <RetentionSection
            key={data.defaultRetentionDays}
            workspace={workspace}
            saved={data.defaultRetentionDays}
            canManage={data.canManage}
          />
        </>
      ) : null}
    </Frame>
  )
}

function RetentionSection({ workspace, saved, canManage }: RetentionSection.Props) {
  const announce = useAnnounce()
  const save = useSaveWorkspaceSettings(workspace)
  const [text, setText] = useState(String(saved))
  const [showProblem, setShowProblem] = useState(false)
  const problem = showProblem ? retentionProblem(text) : null
  const dirty = retentionDirty(saved, text)

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowProblem(true)
    if (retentionProblem(text) || !dirty) return
    save.mutate({ retentionDays: Number(text.trim()) }, { onSuccess: () => announce('Saved') })
  }

  return (
    <form className={styles.section} onSubmit={submit} noValidate aria-labelledby="retention">
      <SectionHeader
        title={<span id="retention">Retention</span>}
        description="Builds and hosted site versions expire after their team’s retention. Each team can set its own in its settings."
      />
      <Box>
        <BoxRow title="Default for new teams" help="Existing teams keep their own setting.">
          <span className={styles.inline}>
            <TextField
              className={styles.daysField}
              label="Days"
              name="retentionDays"
              inputMode="numeric"
              value={text}
              disabled={!canManage}
              error={problem ?? undefined}
              onChange={(e) => setText(e.target.value)}
            />
            <Text tone="secondary">days</Text>
          </span>
        </BoxRow>
        <BoxRow
          top
          title="Never deleted"
          help="The newest approved build on the default branch for each build name (it is the baseline), and any site version a live branch link serves."
        />
        <BoxRow
          top
          title="Unused files"
          help="A file nothing refers to any more is deleted 24 hours later, after CirCI checks again that no new upload claimed it."
        />
      </Box>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {canManage ? (
        <div className={styles.footer}>
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setText(String(saved))
              setShowProblem(false)
              save.reset()
            }}
          >
            Discard
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  )
}

namespace RetentionSection {
  export interface Props {
    workspace: string
    saved: number
    canManage: boolean
  }
}
