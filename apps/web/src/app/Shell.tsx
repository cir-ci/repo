import {
  AnnouncerProvider,
  AppFrame,
  Delayed,
  Drawer,
  IconButton,
  MenuIcon,
  SkipLink,
} from '@circi/ui'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'

import { InvitationBanner } from '#features/auth/InvitationBanner.tsx'
import { AddressChangeBanner } from '#features/instance/AddressChangeBanner.tsx'
import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { TeamDialogs } from '#features/teams/TeamDialogs.tsx'
import { authClient, type SessionUser } from '#lib/auth-client.ts'
import { RouterLink } from '#lib/router-link.ts'

import { currentSection, isOutsideFrame, isSettingsSection, sectionLabel } from './shell-model.ts'
import { ShortcutLayer } from './ShortcutLayer.tsx'
import { Sidebar } from './Sidebar.tsx'

import styles from './Shell.module.css'

// Only people who aren't signed in need the sign-in form, so it's its own chunk.
const LoginPage = lazy(() =>
  import('#features/auth/LoginPage.tsx').then((m) => ({ default: m.LoginPage })),
)

/** The width below which the sidebar becomes a drawer: `AppFrame`'s stacking breakpoint. */
const COMPACT_QUERY = '(max-width: 819.98px)'

/**
 * The frame around every page. Signed in: the sidebar and one panel (`AppFrame`), with a top bar
 * and a drawer instead of the sidebar below 820px. Not signed in: the sign-in page. A site's
 * sign-in handoff is shown without the sidebar. Pages only render (and fetch) once there is a session.
 */
export function Shell() {
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  let content: ReactNode
  if (isPending) {
    // Checking a session takes well under a second, so nothing is shown at first, then a note
    // if it drags on.
    content = (
      <PlainFrame>
        <Delayed>
          <div className={styles.centered}>Checking your session…</div>
        </Delayed>
      </PlainFrame>
    )
  } else if (!user) {
    // The sign-in and setup pages are their own full-viewport layout (no logo bar); the page
    // provides the `main#content` the skip link points at.
    content = (
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    )
  } else if (isOutsideFrame(pathname)) {
    content = (
      <PlainFrame>
        <Notices email={user.email} />
        <Outlet />
      </PlainFrame>
    )
  } else {
    content = <SignedInFrame user={sessionUser(user)} />
  }
  return (
    <AnnouncerProvider>
      <SkipLink href="#content" />
      {content}
    </AnnouncerProvider>
  )
}

/** The parts of the session the shell uses. */
function sessionUser(user: { id: string; name: string; email: string }): SessionUser {
  return { id: user.id, name: user.name, email: user.email }
}

function Notices({ email }: { email: string }) {
  return (
    <>
      <InvitationBanner userEmail={email} />
      <AddressChangeBanner />
    </>
  )
}

/** The ground and the logo for pages that live outside the sidebar frame. */
function PlainFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.plain}>
      <header className={styles.plainBar}>
        <RouterLink to="/" className={styles.logo} aria-label="CirCI home">
          <span className={styles.mark} aria-hidden="true" />
          CirCI
        </RouterLink>
      </header>
      <main id="content" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  )
}

function SignedInFrame({ user }: { user: SessionUser }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  // Settings replace the sidebar with their own navigation (Back to app, Account, Workspace, Team, Instance).
  const nav = isSettingsSection(section) ? <SettingsNav /> : <Sidebar user={user} />
  const navLabel = isSettingsSection(section) ? 'Settings' : 'Main'
  // The drawer belongs to the page it was opened on: choosing another page closes it.
  const [openedAt, setOpenedAt] = useState<string | undefined>(undefined)
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
  }, [])

  return (
    <ShortcutLayer>
      <AppFrame
        sidebar={nav}
        sidebarLabel={navLabel}
        compactBar={
          <div className={styles.bar}>
            <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
              <MenuIcon />
            </IconButton>
            <span className={styles.barTitle}>{sectionLabel(section) ?? 'CirCI'}</span>
          </div>
        }
      >
        <Notices email={user.email} />
        <Outlet />
      </AppFrame>
      <TeamDialogs />
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
        <nav aria-label={navLabel} className={styles.drawerNav}>
          {nav}
        </nav>
      </Drawer>
    </ShortcutLayer>
  )
}
