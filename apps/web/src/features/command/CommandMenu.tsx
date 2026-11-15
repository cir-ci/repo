import type { Sidebar, View } from '@circi/api'
import { CloseIcon, CommandDialog, IconButton, Kbd, SearchIcon, useColorScheme } from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter, useRouterState } from '@tanstack/react-router'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

import { returnTarget } from '#app/settings-return.ts'
import { currentSection, isSettingsSection, type WorkspaceRef } from '#app/shell-model.ts'
import { buildQuery } from '#features/builds/api/index.ts'
import { capabilitiesQuery, projectsQuery } from '#features/projects/api/index.ts'
import { projectMembersQuery } from '#features/projects/api/members.ts'
import { authClient } from '#lib/auth-client.ts'
import { keys } from '#lib/query-keys.ts'
import { openInNewTab } from '#lib/row-menu.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useRecentSearchesStore } from '#lib/stores/recent-searches-store.ts'
import { type RecentEntry, useRecentStore } from '#lib/stores/recent-store.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { useToastStore } from '#lib/stores/toast-store.ts'
import { useWorkspaceStore } from '#lib/stores/workspace-store.ts'
import { clipboard } from '#lib/use-copy.ts'

import { NARROWED_LIMIT, useDebounced, useSearchResults } from './api.ts'
import { CommandPeek } from './CommandPeek.tsx'
import { CommandRow } from './CommandRow.tsx'
import type { Chip, Entry, RowAction } from './entry.ts'
import {
  buildList,
  defaultIndex,
  flatten,
  footerHints,
  isReal,
  keyEvents,
  type ListInput,
  type Needs,
  rememberedSearch,
  scopeOf,
  TIPS,
  wordsOf,
  jumpIndex,
  wrapIndex,
} from './model.ts'
import {
  buildPageAction,
  hasRowActions,
  PAGE_META,
  type PageState,
  pageEntries,
  switchWorkspaceTarget,
} from './pages.ts'
import {
  chipLabel,
  completeProjectToken,
  kindChip,
  KIND_CHIPS,
  placeholderFor,
  readTyped,
  sameChip,
  withoutLastChip,
} from './query.ts'
import { needsReason, performAction, rejectNeedsReason } from './row-actions.ts'

import styles from './CommandMenu.module.css'

const NO_RECENTS: readonly RecentEntry[] = []
const NO_SEARCHES: readonly string[] = []
const NO_WORKSPACES: readonly WorkspaceRef[] = []
const NO_NEEDS: Needs = { reviews: 0, unread: 0, triageAssigned: 0 }

const TIP_COUNT = TIPS.length

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The command menu (⌘K), one list for three intents: go somewhere, find something, do something.
 * Empty, it lists the page's actions, what you visited, what needs you, where to go and what to
 * switch. Typed, it ranks the best match first, then actions and places, then results by kind
 * (three each, with `Show all N …`), limited to the project you are in until you widen it. `#`, `/`
 * and `>` narrow it to builds, screenshots or commands and `in:name` to a project, as chips; rows with
 * a chevron open a nested list; ⌘↵ opens in a new tab, ⌘⇧C copies the link and ⌘. lists the row's
 * actions. Inside settings it offers settings only. ↑ ↓ move, ↵ chooses, Esc goes back or closes.
 */
export function CommandMenu({
  open,
  onOpenChange,
  workspace,
  projects,
  views,
  canManage,
  workspaces = NO_WORKSPACES,
  needs = NO_NEEDS,
}: CommandMenu.Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const params = useParams({ strict: false })
  const { mode, setMode } = useColorScheme()
  const { data: caps } = useQuery(capabilitiesQuery())
  const { data: overview } = useQuery(projectsQuery())
  const { data: session } = authClient.useSession()
  const chooseWorkspace = useWorkspaceStore((s) => s.choose)
  const recents = useRecentStore((s) => (workspace ? s.byWorkspace[workspace] : undefined))
  const returnedApp = useSettingsReturnStore((s) => s.app)
  const searches = useRecentSearchesStore((s) => (workspace ? s.byWorkspace[workspace] : undefined))

  const [text, setText] = useState('')
  const [chips, setChips] = useState<Chip[]>([])
  const [contextCleared, setContextCleared] = useState(false)
  const [stack, setStack] = useState<PageState[]>([])
  const [active, setActive] = useState<number | null>(null)
  const afterClose = useRef<(() => void) | undefined>(undefined)
  const listId = useId()
  const fieldRef = useRef<HTMLInputElement>(null)
  // The last element focused outside the menu: the shortcut has no trigger for the dialog to return to.
  const outside = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && !target.closest('[role="dialog"]')) {
        outside.current = target
      }
    }
    document.addEventListener('focusin', remember)
    return () => document.removeEventListener('focusin', remember)
  }, [])
  const page = stack.at(-1)
  const now = Date.now()
  const [tip, setTip] = useState(0)

  const search = useRouterState({ select: (s) => s.location.search })
  const reviewersFor = page?.page === 'reviewers' ? page.subject : undefined
  const { data: members } = useQuery({
    ...projectMembersQuery(reviewersFor?.workspace ?? '', reviewersFor?.project ?? ''),
    enabled: reviewersFor !== undefined,
  })
  const { data: reviewedBuild } = useQuery({
    ...buildQuery(
      reviewersFor?.workspace ?? '',
      reviewersFor?.project ?? '',
      reviewersFor?.number ?? 0,
    ),
    enabled: reviewersFor !== undefined,
  })

  const inSettings = isSettingsSection(currentSection(pathname))
  const input: ListInput = {
    workspace,
    pathname,
    routeWorkspace: params.workspace,
    projects,
    views,
    workspaces,
    canManage,
    canCreateWorkspace: caps?.canCreateWorkspace === true,
    instanceAdmin: caps?.instanceAdmin === true,
    inSettings,
    needs,
    recents: recents ?? NO_RECENTS,
    searches: searches ?? NO_SEARCHES,
    now,
    changed: changedCount(queryClient.getQueryData(buildKey(params)), params),
    leave: returnTarget(returnedApp, projects),
  }
  const q = text.trim()
  const kind = kindChip(chips)
  const scope = scopeOf(input, chips, contextCleared)
  const { results, pending, failed, retry } = useSearchResults(
    workspace,
    q,
    {
      project: scope?.slug,
      kinds: kind ? KIND_CHIPS[kind].kinds : undefined,
      limit: kind && kind !== 'commands' ? NARROWED_LIMIT : undefined,
    },
    !inSettings && page === undefined && kind !== 'commands',
  )
  const view = buildList(input, {
    query: text,
    chips,
    contextCleared,
    results,
    pending,
    failed,
  })
  const groups = page
    ? [
        {
          id: 'page',
          label: '',
          entries: pageEntries(
            page,
            {
              workspace,
              pathname,
              projects,
              workspaces,
              routeProject: view.context.project?.slug ?? params.project,
              theme: mode,
              members: members?.members,
              meId: session?.user.id,
              authorId: reviewedBuild?.authorUserId,
            },
            text,
          ),
        },
      ]
    : view.groups
  const flat = flatten(groups)
  // Each row's place in the flat list, worked out once (not searched for per row on every render).
  const rowIndex = new Map(flat.map((entry, i) => [entry, i]))
  const current =
    flat.length === 0
      ? -1
      : Math.min(active ?? defaultIndex(groups, q !== '' || page !== undefined), flat.length - 1)
  const highlighted = current < 0 ? undefined : flat[current]
  const optionId = (i: number) => `${listId}-${i}`
  const words = page ? wordsOf(text) : wordsOf(q)

  // The live region: counts once the answer has settled, never one message per keystroke.
  const statusText = page
    ? `In ${PAGE_META[page.page].chip}, ${plural(flat.length, PAGE_META[page.page].noun[0], PAGE_META[page.page].noun[1])}`
    : q === ''
      ? ''
      : view.state === 'searching'
        ? 'Searching'
        : view.state === 'none' || view.state === 'error'
          ? ''
          : plural(flat.filter(isReal).length, 'result', 'results')
  const settled = useDebounced(statusText, 400)

  useEffect(() => {
    if (!open) return
    // Each time the menu opens it starts clean (a close that has not finished leaves nothing behind) with a new tip.
    setText('')
    setChips([])
    setStack([])
    setActive(null)
    setContextCleared(false)
    setTip(Math.floor(Math.random() * TIP_COUNT))
  }, [open])

  useEffect(() => {
    if (open && current >= 0)
      document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- optionId only depends on listId
  }, [open, current, flat.length])

  function reset() {
    setText('')
    setChips([])
    setStack([])
    setActive(null)
    setContextCleared(false)
  }

  function onClosed() {
    reset()
    const run = afterClose.current
    afterClose.current = undefined
    run?.()
  }

  function widen() {
    setChips((c) => c.filter((x) => x.type !== 'project'))
    setContextCleared(true)
    setActive(null)
  }

  function openTab(path: string) {
    openInNewTab(path)
    onOpenChange(false)
  }

  function perform(action: RowAction) {
    const ctx = {
      queryClient,
      me: session?.user,
      origin: window.location.origin,
      copy: async (value: string) => {
        try {
          await clipboard.write(value)
          return true
        } catch {
          return false
        }
      },
      openTab: (url: string) => openInNewTab(url),
    }
    void performAction(action, ctx).then((toast) => {
      if (toast.message) useToastStore.getState().show(toast)
    })
    onOpenChange(false)
  }

  /** Rejecting asks for a reason first when the project requires one; everything else goes at once. */
  function runAction(action: RowAction) {
    if (!needsReason(action)) {
      perform(action)
      return
    }
    void rejectNeedsReason(queryClient, action.subject).then((required) => {
      if (!required) {
        perform(action)
        return
      }
      setStack((s) => [...s, { page: 'reason', action }])
      setText('')
      setActive(null)
    })
  }

  function toggleReviewer(reviewer: { id: string; name: string }) {
    setStack((s) =>
      s.map((p, i) => {
        if (i !== s.length - 1 || p.page !== 'reviewers') return p
        const picked = p.picked ?? []
        return {
          ...p,
          picked: picked.some((r) => r.id === reviewer.id)
            ? picked.filter((r) => r.id !== reviewer.id)
            : [...picked, reviewer],
        }
      }),
    )
  }

  /** The build page's own actions run here, so they undo like the rest (and Reject asks for a reason). */
  function buildPageRun(key: string): boolean {
    if (!params.workspace || !params.project || !params.number) return false
    const shot = typeof search.shot === 'string' ? search.shot : undefined
    const found = buildPageAction(key, {
      workspace: params.workspace,
      project: params.project,
      number: Number(params.number),
      shot,
    })
    if (!found) return false
    if ('page' in found) {
      setStack((s) => [...s, { page: found.page, subject: found.subject }])
      setText('')
      setActive(null)
    } else runAction(found)
    return true
  }

  function choose(entry: Entry) {
    const { target } = entry
    const remembered = workspace ? rememberedSearch(entry, chips, text) : undefined
    if (workspace && remembered) useRecentSearchesStore.getState().record(workspace, remembered)
    switch (target.type) {
      case 'path':
        router.history.push(target.path)
        onOpenChange(false)
        return
      case 'project':
        router.history.push(entry.path ?? '/')
        onOpenChange(false)
        return
      case 'workspace': {
        chooseWorkspace(target.slug)
        const go = switchWorkspaceTarget(
          pathname,
          target.slug,
          (slug) =>
            (overview?.projects ?? [])
              .filter((o) => o.workspace.slug === slug)
              .map((o) => o.project.slug)[0],
        )
        if (go) router.history.push(go)
        onOpenChange(false)
        return
      }
      case 'theme':
        setMode(target.mode)
        onOpenChange(false)
        return
      case 'key': {
        if (buildPageRun(target.key)) return
        // A registry action runs through the shortcut layer once the menu has closed, so a dialog
        // it opens is not closed again by the menu giving focus back. The keys are sent from the
        // page body: sent to the window they are judged by the focused element, which is still
        // inside the closing dialog (and the shortcut layer leaves a dialog's keys alone).
        afterClose.current = () => {
          for (const init of keyEvents(target.key)) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', init))
          }
        }
        onOpenChange(false)
        return
      }
      case 'signOut':
        afterClose.current = () => {
          void authClient.signOut().then(() => {
            queryClient.clear()
            useTabStore.getState().clear()
          })
        }
        onOpenChange(false)
        return
      case 'page':
        setStack((s) => [
          ...s,
          {
            page: target.page,
            ...(target.subject ? { subject: target.subject } : {}),
            ...(target.action ? { action: target.action } : {}),
          },
        ])
        setText('')
        setActive(null)
        return
      case 'chip':
        setChips((c) => (c.some((x) => sameChip(x, target.chip)) ? c : [...c, target.chip]))
        setActive(null)
        return
      case 'widen':
        widen()
        return
      case 'clear':
        setText('')
        setChips([])
        setActive(null)
        return
      case 'retry':
        retry()
        return
      case 'create': {
        // The dialog opens once the menu has closed, so focus is not taken back by the menu.
        const { what } = target
        afterClose.current = () => {
          const overlays = useOverlayStore.getState()
          if (what === 'project') overlays.setNewProjectOpen(true)
          else overlays.setNewWorkspaceOpen(true)
        }
        onOpenChange(false)
        return
      }
      case 'search':
        type(target.text)
        return
      case 'clearSearches':
        if (workspace) useRecentSearchesStore.getState().clear(workspace)
        setActive(null)
        return
      case 'run':
        runAction(target.action)
        return
      case 'reviewer':
        if ((page?.picked ?? []).length > 0) toggleReviewer(target.reviewer)
        else
          runAction({
            type: 'requestReview',
            subject: target.subject,
            reviewers: [target.reviewer],
          })
        return
      case 'noop':
        return
    }
  }

  function back() {
    setStack((s) => s.slice(0, -1))
    setText('')
    setActive(null)
  }

  function type(value: string) {
    if (page) {
      // In a nested list the text finds a row (or is the reason), whatever it starts with.
      setText(value)
      setActive(null)
      return
    }
    const typed = readTyped(value, chips, projects)
    setChips(typed.chips)
    setText(typed.text)
    setActive(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    const move = (delta: 1 | -1) => {
      e.preventDefault()
      setActive(wrapIndex(flat.length, current, delta))
    }
    // Home and End move the caret while there is text to edit (or with ⌘ or Ctrl), else they jump in the list.
    const jump = (to: 'first' | 'last' | 'pageUp' | 'pageDown') => {
      e.preventDefault()
      setActive(jumpIndex(flat.length, current, to))
    }
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'PageDown') jump('pageDown')
    else if (e.key === 'PageUp') jump('pageUp')
    else if ((e.key === 'Home' || e.key === 'End') && (text === '' || mod)) {
      jump(e.key === 'Home' ? 'first' : 'last')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!highlighted) return
      if (e.shiftKey && highlighted.target.type === 'reviewer') {
        toggleReviewer(highlighted.target.reviewer)
      } else if (!mod) choose(highlighted)
      else if (highlighted.kind === 'widen' || (!highlighted.path && scope && q !== '')) widen()
      else if (highlighted.path) openTab(highlighted.path)
      else choose(highlighted)
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      e.stopPropagation()
      if (highlighted?.path) {
        runAction({ type: 'copyLink', path: highlighted.path })
      }
    } else if (mod && e.key === '.') {
      e.preventDefault()
      if (highlighted && hasRowActions(highlighted) && !page) {
        setStack((s) => [...s, { page: 'row', entry: highlighted }])
        setText('')
        setActive(null)
      }
    } else if (e.key === 'Backspace' && text === '') {
      if (page) {
        e.preventDefault()
        back()
      } else if (chips.length > 0) {
        e.preventDefault()
        setChips(withoutLastChip(chips))
        setActive(null)
      } else if (view.showContext) {
        setContextCleared(true)
        setActive(null)
      }
    } else if (e.key === 'ArrowLeft' && page && text === '') {
      e.preventDefault()
      back()
    } else if (e.key === 'Tab') {
      const done = completeProjectToken(text, chips, projects)
      if (done) {
        e.preventDefault()
        setChips(done.chips)
        setText(done.text)
        setActive(null)
      }
    }
  }

  const handleOpenChange: NonNullable<CommandDialog.Props['onOpenChange']> = (next, details) => {
    // Esc goes back one list before it closes the menu.
    if (!next && details.reason === 'escape-key' && stack.length > 0) {
      details.cancel()
      back()
      return
    }
    onOpenChange(next)
  }

  const removable = !page && (chips.length > 0 || view.showContext)
  const hints = footerHints({
    nested: page !== undefined,
    entry: highlighted,
    rowActions: !page && hasRowActions(highlighted),
    removable: removable && text === '',
  })
  const contextName = view.context.project?.name ?? view.context.chip ?? ''

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      onClosed={onClosed}
      label="Command menu"
      wide
      initialFocus={fieldRef}
      // Esc (or a choice that leaves the page as it is) gives focus back to where it was before ⌘K.
      finalFocus={() => {
        const before = outside.current
        return before?.isConnected === true ? before : true
      }}
    >
      <div className={styles.main}>
        <div className={styles.field}>
          <SearchIcon aria-hidden="true" />
          {page ? (
            <span className={styles.chip}>{PAGE_META[page.page].chip}</span>
          ) : (
            <>
              {view.showContext && view.context.chip ? (
                <ChipView
                  label={view.context.chip}
                  remove={`Remove ${contextName} scope`}
                  onRemove={() => setContextCleared(true)}
                />
              ) : null}
              {chips.map((chip) => (
                <ChipView
                  key={chip.type === 'project' ? `project:${chip.slug}` : chip.kind}
                  label={chipLabel(chip)}
                  remove={`Remove ${chipLabel(chip)} scope`}
                  onRemove={() => setChips((c) => c.filter((x) => !sameChip(x, chip)))}
                />
              ))}
            </>
          )}
          <input
            ref={fieldRef}
            className={styles.input}
            role="combobox"
            aria-label={page ? PAGE_META[page.page].placeholder : placeholderFor(chips)}
            // The list is always on screen, but only "expanded" while it has something to choose.
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder={page ? PAGE_META[page.page].placeholder : placeholderFor(chips)}
            value={text}
            onChange={(e) => type(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {/* The full-screen sheet on a phone has no Escape key: a visible way out (hidden elsewhere). */}
          <button type="button" className={styles.cancel} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
        </div>
        <div
          role="status"
          className={'message' in view && view.message ? styles.message : styles.hidden}
        >
          {page || !('message' in view) || !view.message ? settled : view.message}
          {!page && view.tip ? <span className={styles.tip}>{view.tip}</span> : null}
        </div>
        <div id={listId} role="listbox" aria-label="Results" className={styles.list}>
          {groups.map(({ id, label, entries: items }, gi) => {
            const headingId = `${listId}-h-${gi}`
            return (
              <div
                key={id}
                role={label ? 'group' : 'presentation'}
                aria-labelledby={label ? headingId : undefined}
                className={styles.group}
              >
                {label ? (
                  <div id={headingId} className={styles.heading}>
                    {label}
                  </div>
                ) : null}
                {items.map((entry) => {
                  const i = rowIndex.get(entry) ?? -1
                  return (
                    <CommandRow
                      key={entry.id}
                      entry={entry}
                      id={optionId(i)}
                      selected={i === current}
                      words={words}
                      onHover={() => i !== current && setActive(i)}
                      onChoose={() => choose(entry)}
                    />
                  )
                })}
              </div>
            )
          })}
          {!page && view.state === 'searching' ? (
            <div className={styles.searching} aria-hidden="true">
              Searching…
            </div>
          ) : null}
        </div>
        <footer className={styles.footer}>
          <div role="group" aria-label="Keyboard hints" className={styles.hints}>
            {hints.map((hint) => (
              <span
                key={`${hint.keys.join('')}${hint.label}`}
                className={styles.hint}
                data-narrow={hint.narrow ? '' : undefined}
              >
                {hint.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}{' '}
                {hint.label}
              </span>
            ))}
          </div>
        </footer>
      </div>
      <CommandPeek
        entry={highlighted}
        tip={tip}
        onChoose={() => highlighted && choose(highlighted)}
      />
    </CommandDialog>
  )
}

function ChipView({ label, remove, onRemove }: ChipView.Props) {
  return (
    <span className={styles.chip}>
      {label}
      <IconButton label={remove} onClick={onRemove}>
        <CloseIcon size={10} />
      </IconButton>
    </span>
  )
}

namespace ChipView {
  export interface Props {
    label: string
    remove: string
    onRemove: () => void
  }
}

/** The query key of the build on screen, when the address is a build. */
function buildKey(params: { workspace?: string; project?: string; number?: string }) {
  return params.workspace && params.project && params.number
    ? keys.build(params.workspace, params.project, Number(params.number))
    : (['no-build'] as const)
}

/** How many screenshots changed in the build on screen, when its page has loaded it. */
function changedCount(data: unknown, params: { number?: string }): number | undefined {
  if (!params.number || typeof data !== 'object' || data === null || !('build' in data)) {
    return undefined
  }
  const { build } = data
  if (typeof build !== 'object' || build === null || !('counts' in build)) return undefined
  const { counts } = build
  return typeof counts === 'object' &&
    counts !== null &&
    'changed' in counts &&
    typeof counts.changed === 'number'
    ? counts.changed
    : undefined
}

export namespace CommandMenu {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The workspace searched and jumped around in. */
    workspace: string | undefined
    /** Whether the person may change the workspace's settings; false sends Settings to Members. */
    canManage?: boolean | undefined
    projects: readonly Sidebar.Project[] | undefined
    views: readonly View.Item[] | undefined
    /** The workspaces to switch between. */
    workspaces?: readonly WorkspaceRef[]
    /** What waits for the person, from the sidebar's counts. */
    needs?: Needs
  }
}
