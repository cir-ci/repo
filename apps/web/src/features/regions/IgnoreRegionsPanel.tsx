import type { IgnoreRegion } from '@circi/api'
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  Heading,
  NumberField,
  Text,
  useAnnounce,
} from '@circi/ui'
import { type FormEvent, useId, useState } from 'react'

import {
  useAddIgnoreRegion,
  useDeleteIgnoreRegion,
  useEditIgnoreRegion,
} from '#features/teams/api/index.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { defaultRect, parseRect, type RectFields, type Size } from './ignore-regions.ts'

import styles from './IgnoreRegionsEditor.module.css'

/**
 * A screenshot's ignore regions as a list: add one from numbers, edit or remove one. Owners and
 * admins (`canManage`) get the controls; members see the regions. Each confirmed action applies
 * when it is confirmed. The baseline page and the build review both show it.
 */
export function IgnoreRegionsPanel({
  workspace,
  team,
  name,
  size,
  regions,
  canManage,
  error,
  footer = true,
}: IgnoreRegionsPanel.Props) {
  const remove = useDeleteIgnoreRegion(workspace, team)
  const announce = useAnnounce()
  const [dialog, setDialog] = useState<RegionDialog.Target | null>(null)
  const [removing, setRemoving] = useState<{ item: IgnoreRegion.Item; number: number } | null>(null)
  const regionsHeading = useId()

  return (
    <>
      <section className={styles.panel} aria-labelledby={regionsHeading}>
        <div className={styles.bar}>
          <Heading as="h2" id={regionsHeading} className={styles.barTitle}>
            Ignore regions
            <Text variant="small" tone="tertiary">
              {regions.length}
            </Text>
          </Heading>
          {canManage ? (
            <span className={styles.barActions}>
              <Button size="sm" onClick={() => setDialog({ kind: 'add', name, size })}>
                Add region
              </Button>
            </span>
          ) : null}
        </div>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <ul aria-label={`Regions of ${name}`} className={styles.regions}>
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
              {canManage ? (
                <>
                  <Button
                    size="sm"
                    aria-label={`Edit region ${index + 1}`}
                    onClick={() => setDialog({ kind: 'edit', region: r, size })}
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
                </>
              ) : null}
            </li>
          ))}
        </ul>
        {regions.length === 0 ? (
          <Text as="p" tone="secondary" className={styles.note}>
            No ignore regions on this screenshot yet.
          </Text>
        ) : null}
        {footer ? (
          <div className={styles.foot}>
            <Text variant="small" tone="tertiary">
              Regions are blanked out on both images before comparing, and apply to every build.
              {canManage && !size ? ' Its size is unknown, so regions can’t be drawn.' : ''}
            </Text>
          </div>
        ) : null}
      </section>
      <RegionDialog
        key={dialog?.kind === 'edit' ? dialog.region.id : (dialog?.kind ?? 'none')}
        target={dialog}
        workspace={workspace}
        team={team}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove this ignore region?"
        description={`Region ${removing?.number ?? ''} of ${name} is compared again from the next build.`}
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

export namespace IgnoreRegionsPanel {
  export interface Props {
    workspace: string
    team: string
    /** The screenshot's name. */
    name: string
    /** The screenshot's pixel size; null when unknown. */
    size: Size | null
    regions: readonly IgnoreRegion.Item[]
    /** Owners and admins: the others see the regions and nothing to change them with. */
    canManage: boolean
    /** A failure of an ignore region drawn on the image, shown above the list. */
    error?: string | undefined
    /** The note under the list; the build review leaves it out. Default true. */
    footer?: boolean
  }
}

/** Position and size of one region in pixels: edits an existing region, or adds one (to a screenshot) from numbers. */
function RegionDialog({ target, workspace, team, onClose }: RegionDialog.Props) {
  const edit = useEditIgnoreRegion(workspace, team)
  const add = useAddIgnoreRegion(workspace, team)
  const announce = useAnnounce()
  const [problem, setProblem] = useState<string | null>(null)
  const adding = target?.kind === 'add'
  const save = adding ? add : edit
  const initial =
    target?.kind === 'edit' ? target.region : target?.size ? defaultRect(target.size) : undefined

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!target) return
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
    const parsed = parseRect(fields, target.size)
    if (!parsed.ok) {
      setProblem(parsed.error)
      return
    }
    setProblem(null)
    const done = {
      onSuccess: () => {
        announce(target.kind === 'add' ? 'Ignore region added' : 'Ignore region saved')
        onClose()
      },
    }
    if (target.kind === 'add') add.mutate({ name: target.name, ...parsed.rect }, done)
    else edit.mutate({ id: target.region.id, rect: parsed.rect }, done)
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={adding ? 'Add an ignore region' : 'Edit ignore region'}
      description={
        adding
          ? `Position and size in pixels of ${target.name}.`
          : 'Position and size in pixels of the screenshot.'
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-region" variant="primary" loading={save.isPending}>
            {save.isPending ? 'Saving…' : adding ? 'Add region' : 'Save region'}
          </Button>
        </>
      }
    >
      <form id="edit-region" onSubmit={submit} noValidate className={styles.editForm}>
        <NumberField name="x" label="Left" unit="px" defaultValue={initial?.x} min={0} step={1} />
        <NumberField name="y" label="Top" unit="px" defaultValue={initial?.y} min={0} step={1} />
        <NumberField
          name="width"
          label="Width"
          unit="px"
          defaultValue={initial?.width}
          min={1}
          step={1}
        />
        <NumberField
          name="height"
          label="Height"
          unit="px"
          defaultValue={initial?.height}
          min={1}
          step={1}
        />
        {problem ? (
          <Text variant="small" tone="rejected" role="alert" className={styles.problem}>
            {problem}
          </Text>
        ) : null}
        {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

namespace RegionDialog {
  /** What the dialog is for; `size` (the screenshot's pixels, when known) bounds the region. */
  export type Target =
    | { kind: 'add'; name: string; size: Size | null }
    | { kind: 'edit'; region: IgnoreRegion.Item; size: Size | null }

  export interface Props {
    target: Target | null
    workspace: string
    team: string
    onClose: () => void
  }
}
