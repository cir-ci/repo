import { AnnouncerProvider, AppFrame, PanelNotices, SkipLink } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'

import { InvitationBanner } from '#features/auth/InvitationBanner.tsx'
import { SessionCheck } from '#features/auth/SessionCheck.tsx'
import { AddressChangeBanner } from '#features/instance/AddressChangeBanner.tsx'
import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { ProjectDialogs } from '#features/projects/ProjectDialogs.tsx'
import { AddToHomeScreenSheet } from '#features/pwa/AddToHomeScreenSheet.tsx'
import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { authClient, type SessionUser } from '#lib/auth-client.ts'
import { dismissBootScreenAfter } from '#lib/boot-screen.ts'
import { PaneHandle } from '#lib/PaneHandle.tsx'
import { paneWidthCss } from '#lib/panes.ts'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import { useSetupStore } from '#lib/stores/setup-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { AppContextMenu } from './AppContextMenu.tsx'
import { useNavPane } from './NavToggle.tsx'
import { PhoneTabs } from './PhoneTabs.tsx'
import { PhoneTabSwitcher } from './PhoneTabSwitcher.tsx'
import { SettingsSections } from './SettingsSections.tsx'
import { currentSection, isBuildPage, isOutsideFrame, isSettingsSection } from './shell-model.ts'
import { ShortcutLayer } from './ShortcutLayer.tsx'
import { Sidebar } from './Sidebar.tsx'
import { TabGate } from './TabGate.tsx'
import { TabRow } from './TabRow.tsx'
import { WindowTitleBar } from './WindowTitleBar.tsx'

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
 * and the bottom tabs instead of the sidebar below 820px (no drawer). Not signed in: the sign-in page. A site's
 * sign-in handoff is its own full-viewport page, without the sidebar or banners. Pages only render (and fetch) once there is a session.
 */
export function Shell() {
  const { data: session, isPending } = authClient.useSession()
  // Once the session is known, whatever came first (the sign-in page, the app) takes over from
  // index.html's loading screen, after its own logo or first image is drawn.
  useEffect(() => {
    if (!isPending) dismissBootScreenAfter(document.querySelector<HTMLImageElement>('#content img'))
  }, [isPending])
  const user = session?.user
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  let content: ReactNode
  if (isPending) {
    // The sign-in page's ground and logo while the session is checked (a refresh lands here).
    content = <SessionCheck />
  } else if (!user) {
    // The sign-in and setup pages are their own full-viewport layout (no logo bar); the page
    // provides the `main#content` the skip link points at. While its code loads, the same logo
    // screen as the session check, so a refresh never goes blank between the two.
    content = (
      <Suspense fallback={<SessionCheck />}>
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
 * the instance admin is told), and stay while the first project's token is on screen. The
 * frame waits for them only right after the account was made on the setup page, so it never flashes
 * before the steps.
 */
function SetupGate({ user }: { user: SessionUser }) {
  const { data: caps, isPending } = useQuery(capabilitiesQuery())
  const holding = useSetupStore((s) => s.project !== undefined)
  const arriving = useSetupStore((s) => s.arriving)
  if (isPending && arriving) return <SessionCheck />
  if (caps?.setupPending || holding) {
    return (
      <Suspense fallback={<SessionCheck />}>
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
  // Settings replace the sidebar with their own navigation (Back to app, Account, Workspace, Project, Instance).
  const inSettings = isSettingsSection(section)
  const phone = usePhone()
  // A phone has no sidebar: the bottom tabs and the More sheet (and, in settings, the sections
  // sheet) are its navigation.
  const nav = phone ? null : inSettings ? <SettingsNav /> : <Sidebar user={user} />
  const navLabel = inSettings ? 'Settings' : 'Main'
  const pane = useNavPane()
  const sidebarWidth = usePaneWidth(pane.id)
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
        panelTop={<TabRow />}
        {...(phone && !inSettings && !isBuildPage(pathname) ? { bottomBar: <PhoneTabs /> } : {})}
      >
        {/* The notices show under each page's sticky header, inside the panel (`PanelHeader`). */}
        <PanelNotices notices={<Notices email={user.email} />}>
          <TabGate userId={user.id}>
            <Outlet />
          </TabGate>
        </PanelNotices>
      </AppFrame>
      <ProjectDialogs />
      <WindowTitleBar />
      <AppContextMenu />
      <AddToHomeScreenSheet />
      {phone ? <PhoneTabSwitcher /> : null}
      {phone && inSettings ? <SettingsSections /> : null}
    </ShortcutLayer>
  )
}
