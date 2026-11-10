import { AnnouncerProvider, AppFrame, Drawer, PanelNotices, SkipLink } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'

import { InvitationBanner } from '#features/auth/InvitationBanner.tsx'
import { SessionCheck } from '#features/auth/SessionCheck.tsx'
import { AddressChangeBanner } from '#features/instance/AddressChangeBanner.tsx'
import { AddToHomeScreenSheet } from '#features/pwa/AddToHomeScreenSheet.tsx'
import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { TeamDialogs } from '#features/teams/TeamDialogs.tsx'
import { authClient, type SessionUser } from '#lib/auth-client.ts'
import { PaneHandle } from '#lib/PaneHandle.tsx'
import { paneWidthCss } from '#lib/panes.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import { useSetupStore } from '#lib/stores/setup-store.ts'
import { COMPACT_QUERY, usePhone } from '#lib/use-phone.ts'

import { useNavPane } from './NavToggle.tsx'
import { PhoneMore } from './PhoneMore.tsx'
import { PhoneTabs } from './PhoneTabs.tsx'
import { currentSection, isBuildPage, isOutsideFrame, isSettingsSection } from './shell-model.ts'
import { ShortcutLayer } from './ShortcutLayer.tsx'
import { Sidebar } from './Sidebar.tsx'
import { WindowTitleBar } from './WindowTitleBar.tsx'

import styles from './Shell.module.css'

// Only people who aren't signed in need the sign-in form, so it's its own chunk.
const LoginPage = lazy(() =>
  import('#features/auth/LoginPage.tsx').then((m) => ({ default: m.LoginPage })),
)
// Likewise only the instance admin, once, right after the account is made.
const SetupContinue = lazy(() =>
  import('#features/setup/SetupContinue.tsx').then((m) => ({ default: m.SetupContinue })),
)

/**
 * The frame around every page. Signed in: the sidebar and one panel (`AppFrame`), with a top bar
 * and a drawer instead of the sidebar below 820px. Not signed in: the sign-in page. A site's
 * sign-in handoff is its own full-viewport page, without the sidebar or banners. Pages only render (and fetch) once there is a session.
 */
export function Shell() {
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  let content: ReactNode
  if (isPending) {
    // The sign-in page's ground and logo while the session is checked (a refresh lands here).
    content = <SessionCheck />
  } else if (!user) {
    // The sign-in and setup pages are their own full-viewport layout (no logo bar); the page
    // provides the `main#content` the skip link points at.
    content = (
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    )
  } else if (isOutsideFrame(pathname)) {
    // A handoff page is its own full-viewport layout like the sign-in page: it provides the
    // `main#content`, and no invitation or address banners (it is a step on the way to a site).
    content = <Outlet />
  } else {
    content = <SetupGate user={sessionUser(user)} />
  }
  return (
    <AnnouncerProvider>
      <SkipLink href="#content" />
      {content}
    </AnnouncerProvider>
  )
}

/**
 * First-run setup's later steps come before the app while the server says they are pending (only
 * the instance admin is told), and stay while the first team's token is on screen. The
 * frame waits for them only right after the account was made on the setup page, so it never flashes
 * before the steps.
 */
function SetupGate({ user }: { user: SessionUser }) {
  const { data: caps, isPending } = useQuery(capabilitiesQuery())
  const holding = useSetupStore((s) => s.team !== undefined)
  const arriving = useSetupStore((s) => s.arriving)
  if (isPending && arriving) return <SessionCheck />
  if (caps?.setupPending || holding) {
    return (
      <Suspense fallback={null}>
        <SetupContinue />
      </Suspense>
    )
  }
  return <SignedInFrame user={user} />
}

/** The parts of the session the shell uses. */
function sessionUser(user: {
  id: string
  name: string
  email: string
  image?: string | null | undefined
}): SessionUser {
  return { id: user.id, name: user.name, email: user.email, image: user.image ?? null }
}

function Notices({ email }: { email: string }) {
  return (
    <>
      <InvitationBanner userEmail={email} />
      <AddressChangeBanner />
    </>
  )
}

/** The app frame around the sidebar's wrapper: the width the sidebar's share is taken of. */
const frameOf = (handle: HTMLElement) => handle.parentElement?.parentElement

function SignedInFrame({ user }: { user: SessionUser }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  // Settings replace the sidebar with their own navigation (Back to app, Account, Workspace, Team, Instance).
  const inSettings = isSettingsSection(section)
  const nav = inSettings ? <SettingsNav /> : <Sidebar user={user} />
  const navLabel = inSettings ? 'Settings' : 'Main'
  const phone = usePhone()
  const pane = useNavPane()
  const sidebarWidth = usePaneWidth(pane.id)
  // The drawer belongs to the page it was opened on: choosing another page closes it (an entry
  // that only expands, a team, moves it along instead: `NavLink`'s `expands`).
  const openedAt = useOverlayStore((s) => s.drawerAt)
  const setOpenedAt = useOverlayStore((s) => s.setDrawerAt)
  const drawerOpen = openedAt === pathname
  const setDrawerOpen = (open: boolean) => setOpenedAt(open ? pathname : undefined)

  // The window grew past the drawer's width: close it.
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const onChange = () => {
      if (!query.matches) setOpenedAt(undefined)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [setOpenedAt])

  return (
    <ShortcutLayer>
      <AppFrame
        sidebar={nav}
        sidebarLabel={navLabel}
        sidebarWidth={paneWidthCss(pane.id, sidebarWidth)}
        sidebarCollapsed={pane.collapsed}
        sidebarHandle={
          <PaneHandle
            pane={pane.id}
            cssVar="--circi-sidebar-width"
            at="100%"
            container={frameOf}
            onCollapse={pane.collapse}
          />
        }
        compact
        {...(phone && !inSettings && !isBuildPage(pathname) ? { bottomBar: <PhoneTabs /> } : {})}
      >
        {/* The notices show under each page's sticky header, inside the panel (`PanelHeader`). */}
        <PanelNotices notices={<Notices email={user.email} />}>
          <Outlet />
        </PanelNotices>
      </AppFrame>
      <TeamDialogs />
      <WindowTitleBar />
      <AddToHomeScreenSheet />
      {phone && !inSettings ? <PhoneMore /> : null}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
        <nav aria-label={navLabel} className={styles.drawerNav}>
          {nav}
        </nav>
      </Drawer>
    </ShortcutLayer>
  )
}
