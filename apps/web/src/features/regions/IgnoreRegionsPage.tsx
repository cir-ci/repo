import type { Comment, IgnoreRegion } from '@circi/api'
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { TeamSettingsFrame } from '#features/team-settings/TeamSettingsFrame.tsx'
import {
  ignoreRegionsQuery,
  useAddIgnoreRegion,
  useDeleteIgnoreRegion,
  useEditIgnoreRegion,
} from '#features/teams/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import {
  parseRect,
  pickSnapshot,
  regionsOf,
  sizeOf,
  toPixels,
  type RectFields,
} from './ignore-regions.ts'
import { RegionStage } from './RegionStage.tsx'

import styles from './IgnoreRegionsPage.module.css'

/** Parts of a screenshot CirCI blanks out before comparing: grouped by screenshot name. */
export function IgnoreRegionsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/ignore-regions' })
  return (
    <TeamSettingsFrame
      workspace={workspace}
      team={team}
      page="Ignore regions"
      width="wide"
      readOnlyNote={false}
    >
      {(data, name) => (
        <Workbench
          workspace={workspace}
          team={team}
          teamName={name}
          defaultBranch={data.settings.defaultBranch}
        />
      )}
    </TeamSettingsFrame>
  )
}

function Workbench({ workspace, team, teamName, defaultBranch }: Workbench.Props) {
  const { data, error, refetch } = useQuery(ignoreRegionsQuery(workspace, team))
  const search = useSearch({ from: '/$workspace/$team/settings/ignore-regions' })
  const navigate = useNavigate()
  const announce = useAnnounce()
  const add = useAddIgnoreRegion(workspace, team)
  const remove = useDeleteIgnoreRegion(workspace, team)
  const [drawing, setDrawing] = useState(false)
  const [pending, setPending] = useState<Comment.Region | null>(null)
  const [editing, setEditing] = useState<IgnoreRegion.Item | null>(null)
  const [removing, setRemoving] = useState<{ item: IgnoreRegion.Item; number: number } | null>(null)

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  const snapshot = pickSnapshot(data.snapshots, search.name)
  const intro = (
    <Text as="p" tone="secondary" className={styles.lead}>
      Parts of a screenshot CirCI blanks out on both images before comparing, such as clocks, ads or
      charts with live data. Regions belong to a screenshot name and apply to every build of{' '}
      {teamName}.
    </Text>
  )
  if (!snapshot) {
    return (
      <>
        {intro}
        <EmptyState title="No ignore regions yet">
          Flaky screenshots in Triage link here: press I on one to add a region for its screenshot.
        </EmptyState>
      </>
    )
  }

  const regions = regionsOf(data.regions, snapshot.name)
  const size = sizeOf(snapshot.latest)

  return (
    <>
      {intro}
      <div className={styles.split}>
        <div className={styles.list} role="listbox" aria-label="Screenshots with ignore regions">
          {data.snapshots.map((s) => (
            <button
              key={s.name}
              type="button"
              role="option"
              aria-selected={s.name === snapshot.name}
              className={styles.option}
              data-selected={s.name === snapshot.name ? '' : undefined}
              onClick={() => {
                setDrawing(false)
                void navigate({
                  to: '/$workspace/$team/settings/ignore-regions',
                  params: { workspace, team },
                  search: { name: s.name },
                  replace: true,
                })
              }}
            >
              {s.latest ? (
                <img
                  src={fileUrl(s.latest.sha256)}
                  alt=""
                  className={styles.thumb}
                  loading="lazy"
                />
              ) : (
                <span className={styles.thumb} />
              )}
              <span className={styles.optionName}>{s.name}</span>
              <Badge aria-label={`${s.regions} ${s.regions === 1 ? 'region' : 'regions'}`}>
                {s.regions}
              </Badge>
            </button>
          ))}
        </div>

        <div className={styles.panel}>
          <div className={styles.bar}>
            <Text variant="mono" className={styles.barName}>
              {snapshot.name}
            </Text>
            <Button
              variant="toggle"
              size="sm"
              pressed={drawing}
              onPressedChange={setDrawing}
              disabled={!size || add.isPending}
            >
              Draw region
            </Button>
          </div>
          {add.error ? <Banner tone="danger">{add.error.message}</Banner> : null}
          {snapshot.latest ? (
            <RegionStage
              name={snapshot.name}
              latest={snapshot.latest}
              size={size}
              regions={regions}
              drawing={drawing}
              onDrawingChange={setDrawing}
              pending={pending}
              onDraw={(region) => {
                if (!size) return
                setPending(region)
                add.mutate(
                  { name: snapshot.name, ...toPixels(region, size) },
                  {
                    onSuccess: () => {
                      setDrawing(false)
                      announce('Ignore region added')
                    },
                    onSettled: () => setPending(null),
                  },
                )
              }}
            />
          ) : (
            <Text as="p" tone="secondary" className={styles.note}>
              No screenshot named {snapshot.name} on {defaultBranch} yet, so there is nothing to
              draw on.
            </Text>
          )}
          <div className={styles.foot}>
            <Text variant="small" tone="tertiary">
              {snapshot.latest
                ? `Latest screenshot from ${defaultBranch}, build #${snapshot.latest.buildNumber}. ${size ? 'Drawing a region needs a mouse for now.' : 'Its size is unknown, so regions can’t be drawn.'}`
                : ' '}
            </Text>
          </div>
          <ul aria-label={`Regions of ${snapshot.name}`} className={styles.regions}>
            {regions.map((r, index) => (
              <li key={r.id} className={styles.region}>
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.regionText}>
                  <Text variant="mono">
                    {r.width}×{r.height} at {r.x}, {r.y}
                  </Text>
                  <Text variant="small" tone="tertiary">
                    {r.createdBy ? `Added by ${r.createdBy.name}` : 'Added from the command line'}{' '}
                    <RelativeTime iso={r.createdAt} />
                  </Text>
                </span>
                <Button
                  size="sm"
                  aria-label={`Edit region ${index + 1}`}
                  onClick={() => setEditing(r)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`Remove region ${index + 1}`}
                  onClick={() => {
                    remove.reset()
                    setRemoving({ item: r, number: index + 1 })
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Text as="p" variant="small" tone="tertiary" className={styles.lead}>
        Flaky snapshots in Triage link here: press I on one to add a region for its screenshot.
      </Text>

      <EditDialog
        key={editing?.id ?? 'none'}
        region={editing}
        workspace={workspace}
        team={team}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove this ignore region?"
        description={`Region ${removing?.number ?? ''} of ${snapshot.name} is compared again from the next build.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          remove.mutate(removing.item.id, {
            onSuccess: () => announce('Ignore region removed'),
            onSettled: () => setRemoving(null),
          })
        }}
      />
      {remove.error && !removing ? <Banner tone="danger">{remove.error.message}</Banner> : null}
    </>
  )
}

function EditDialog({ region, workspace, team, onClose }: EditDialog.Props) {
  const edit = useEditIgnoreRegion(workspace, team)
  const announce = useAnnounce()
  const [problem, setProblem] = useState<string | null>(null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!region) return
    const form = new FormData(e.currentTarget)
    const field = (key: string) => {
      const v = form.get(key)
      return typeof v === 'string' ? v : ''
    }
    const fields: RectFields = {
      x: field('x'),
      y: field('y'),
      width: field('width'),
      height: field('height'),
    }
    const parsed = parseRect(fields)
    if (!parsed.ok) {
      setProblem(parsed.error)
      return
    }
    setProblem(null)
    edit.mutate(
      { id: region.id, rect: parsed.rect },
      {
        onSuccess: () => {
          announce('Ignore region saved')
          onClose()
        },
      },
    )
  }

  return (
    <Dialog
      open={region !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Edit ignore region"
      description="Position and size in pixels of the screenshot."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-region" variant="primary" loading={edit.isPending}>
            {edit.isPending ? 'Saving…' : 'Save region'}
          </Button>
        </>
      }
    >
      <form id="edit-region" onSubmit={submit} noValidate className={styles.editForm}>
        <TextField name="x" label="Left" type="number" defaultValue={region?.x} min={0} step={1} />
        <TextField name="y" label="Top" type="number" defaultValue={region?.y} min={0} step={1} />
        <TextField
          name="width"
          label="Width"
          type="number"
          defaultValue={region?.width}
          min={1}
          step={1}
        />
        <TextField
          name="height"
          label="Height"
          type="number"
          defaultValue={region?.height}
          min={1}
          step={1}
        />
        {problem ? (
          <Text variant="small" tone="rejected" role="alert" className={styles.problem}>
            {problem}
          </Text>
        ) : null}
        {edit.error ? <Banner tone="danger">{edit.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

namespace Workbench {
  export interface Props {
    workspace: string
    team: string
    teamName: string
    defaultBranch: string
  }
}

namespace EditDialog {
  export interface Props {
    region: IgnoreRegion.Item | null
    workspace: string
    team: string
    onClose: () => void
  }
}
