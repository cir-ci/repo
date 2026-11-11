import { CloseIcon, IconButton, PinIcon, PlusIcon, Sheet } from '@circi/ui'
import { type PointerEvent, useRef, useState } from 'react'

import { useInstalled } from '#lib/document-title.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { hrefOf, type Tab, titleOf } from '#lib/tabs.ts'
import { usePhone } from '#lib/use-phone.ts'

import { TabTile } from './TabStrip.tsx'

import styles from './PhoneTabSwitcher.module.css'

/** How far a card is dragged sideways before letting go closes it. */
const SWIPE_PX = 80
/** How long a card is held before its sheet opens. */
const HOLD_MS = 500
/** A finger that moves further than this is scrolling or swiping, not holding. */
const SLOP_PX = 10

/** The count of open tabs in the page header on a phone in the installed app; it opens the switcher. */
export function PhoneTabsButton() {
  const phone = usePhone()
  const count = useTabStore((s) => s.tabs.length)
  const setOpen = useOverlayStore((s) => s.setTabsOpen)
  const installed = useInstalled()
  if (!phone || !installed || count === 0) return null
  return (
    <IconButton label={`Tabs, ${count} open`} onClick={() => setOpen(true)}>
      <span className={styles.count} aria-hidden="true">
        {count}
      </span>
    </IconButton>
  )
}

/**
 * The phone's tab switcher: a grid of cards (tile and title) like a mobile browser's. Tap
 * switches; the 44px × or a swipe sideways closes; holding a card opens a sheet with Pin, Close and
 * Close others. Pinned tabs come first and the active one has the accent outline. Nothing is
 * swipe-only: the × and the sheet do the same.
 */
export function PhoneTabSwitcher() {
  const open = useOverlayStore((s) => s.tabsOpen)
  const setOpen = useOverlayStore((s) => s.setTabsOpen)
  const tabs = useTabStore((s) => s.tabs)
  const activeId = useTabStore((s) => s.activeId)
  const closedCount = useTabStore((s) => s.closed.length)
  const [holding, setHolding] = useState<Tab | null>(null)
  const activate = useTabStore((s) => s.activate)
  const close = useTabStore((s) => s.close)
  const openNew = useTabStore((s) => s.openNew)
  const restore = useTabStore((s) => s.restore)
  const installed = useInstalled()

  return (
    <>
      <Sheet
        open={open && installed}
        onOpenChange={setOpen}
        title={`${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'}`}
        size="tall"
        headerEnd={
          <IconButton
            label="New tab"
            onClick={() => {
              openNew()
              setOpen(false)
            }}
          >
            <PlusIcon size={16} />
          </IconButton>
        }
        footer={
          closedCount > 0 ? (
            <button type="button" className={styles.footer} onClick={restore}>
              Reopen closed tab
            </button>
          ) : undefined
        }
      >
        <ul className={styles.grid}>
          {tabs.map((tab) => (
            <TabCard
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onOpen={() => {
                activate(tab.id)
                setOpen(false)
              }}
              onClose={() => close(tab.id)}
              onHold={() => setHolding(tab)}
            />
          ))}
        </ul>
      </Sheet>
      <Sheet
        open={holding !== null}
        onOpenChange={(next) => {
          if (!next) setHolding(null)
        }}
        title={holding ? titleOf(holding) : ''}
      >
        {holding ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                useTabStore.getState().togglePin(holding.id)
                setHolding(null)
              }}
            >
              {holding.pinned ? 'Unpin tab' : 'Pin tab'}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                close(holding.id)
                setHolding(null)
              }}
            >
              Close tab
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                useTabStore.getState().closeOthers(holding.id)
                setHolding(null)
              }}
            >
              Close other tabs
            </button>
          </div>
        ) : null}
      </Sheet>
    </>
  )
}

function TabCard({ tab, active, onOpen, onClose, onHold }: TabCard.Props) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  const [dx, setDx] = useState(0)
  // What `up` reads: the last move, even when no render came between it and the release (a quick flick).
  const dragged = useRef(0)

  const stopTimer = () => clearTimeout(timer.current)
  const down = (event: PointerEvent) => {
    start.current = { x: event.clientX, y: event.clientY }
    held.current = false
    dragged.current = 0
    timer.current = setTimeout(() => {
      held.current = true
      start.current = null
      dragged.current = 0
      setDx(0)
      onHold()
    }, HOLD_MS)
  }
  const move = (event: PointerEvent) => {
    const from = start.current
    if (!from) return
    const x = event.clientX - from.x
    if (Math.abs(x) > SLOP_PX || Math.abs(event.clientY - from.y) > SLOP_PX) stopTimer()
    dragged.current = x
    setDx(x)
  }
  const up = () => {
    stopTimer()
    const swiped = start.current !== null && Math.abs(dragged.current) >= SWIPE_PX
    start.current = null
    dragged.current = 0
    setDx(0)
    if (swiped) onClose()
  }

  const label = titleOf(tab)
  return (
    <li
      className={styles.card}
      data-active={active ? '' : undefined}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.abs(dx) / 300 } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className={styles.open}
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          // The click that ends a long press or a drag is not a tap.
          if (!held.current) onOpen()
        }}
      >
        <TabTile href={hrefOf(tab)} />
        <span className={styles.title}>{label}</span>
        {tab.pinned ? <PinIcon size={14} aria-label="Pinned" /> : null}
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label={`Close ${label}`}
        onClick={onClose}
      >
        <CloseIcon size={16} />
      </button>
    </li>
  )
}

namespace TabCard {
  export interface Props {
    tab: Tab
    active: boolean
    onOpen: () => void
    onClose: () => void
    onHold: () => void
  }
}
