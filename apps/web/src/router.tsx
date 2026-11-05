import { Box, Link as MuiLink, Typography } from '@mui/material'
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  useParams,
} from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

import { RouterLink } from './components.tsx'
import { InvitationBanner } from './features/auth/InvitationBanner.tsx'
import { UserMenu } from './features/auth/UserMenu.tsx'
import { AddressChangeBanner } from './features/instance/AddressChangeBanner.tsx'
import { authClient } from './lib/auth-client.ts'
import { Blankslate } from './primitives/Blankslate.tsx'
import { AnnouncerProvider, Delayed } from './primitives/feedback.tsx'

// Only people who aren't signed in need the sign-in form, so it's its own chunk.
const LoginPage = lazy(() =>
  import('./features/auth/LoginPage.tsx').then((m) => ({ default: m.LoginPage })),
)

/**
 * App frame per Primer's page regions: an app header that scrolls with the page (never fixed),
 * with the context region (`org / project`) for orientation, then the page itself in <main>.
 */
function AppFrame() {
  const params = useParams({ strict: false })
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user
  return (
    <AnnouncerProvider>
      <MuiLink
        href="#content"
        sx={{
          position: 'absolute',
          left: 8,
          top: -48,
          zIndex: 1,
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          '&:focus': { top: 8 },
        }}
      >
        Skip to content
      </MuiLink>
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minHeight: 56,
          px: { xs: 2, xl: 3 },
          bgcolor: 'action.hover',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <RouterLink
          to="/"
          underline="none"
          color="inherit"
          aria-label="CirCI home"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
        >
          <Box
            aria-hidden
            sx={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: 4,
              borderColor: 'text.primary',
              borderRightColor: 'transparent',
            }}
          />
          <Typography component="span" sx={{ fontWeight: 600 }}>
            CirCI
          </Typography>
        </RouterLink>
        {user && params.org ? (
          <Box
            component="nav"
            aria-label="Context"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minWidth: 0,
              typography: 'body1',
            }}
          >
            <Box component="span" sx={{ color: 'text.secondary' }} aria-hidden>
              /
            </Box>
            <RouterLink
              to="/organizations/$org/members"
              params={{ org: params.org }}
              color="inherit"
              sx={{ color: 'text.secondary' }}
              aria-label={`${params.org} members`}
            >
              {params.org}
            </RouterLink>
            {params.project ? (
              <>
                <Box component="span" sx={{ color: 'text.secondary' }} aria-hidden>
                  /
                </Box>
                <RouterLink
                  to="/$org/$project"
                  params={{ org: params.org, project: params.project }}
                  color="inherit"
                  sx={{
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {params.project}
                </RouterLink>
              </>
            ) : null}
          </Box>
        ) : null}
        {user ? <UserMenu user={{ id: user.id, name: user.name, email: user.email }} /> : null}
      </Box>
      <Box component="main" id="content" tabIndex={-1} sx={{ outline: 'none' }}>
        {/* Pages only render (and fetch) once there's a session. Checking one takes well under
            a second, so nothing is shown at first, then a spinner if it drags on. */}
        {isPending ? (
          <Delayed>
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              Checking your session…
            </Box>
          </Delayed>
        ) : user ? (
          <>
            <InvitationBanner userEmail={user.email} />
            <AddressChangeBanner />
            <Outlet />
          </>
        ) : (
          <Suspense fallback={null}>
            <LoginPage />
          </Suspense>
        )}
      </Box>
    </AnnouncerProvider>
  )
}

function NotFound() {
  return (
    <Blankslate
      icon={<span aria-hidden>404</span>}
      heading="This page doesn’t exist"
      description="Check the address, or start again from the list of projects."
      primaryAction={<RouterLink to="/">Go to projects</RouterLink>}
    />
  )
}

const rootRoute = createRootRoute({ component: AppFrame, notFoundComponent: NotFound })

// Each page is its own chunk, loaded on first visit (and preloaded when a link is hovered).
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(
    () => import('./features/projects/ProjectsPage.tsx'),
    'ProjectsPage',
  ),
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project',
  validateSearch: (search: Record<string, unknown>): { before?: number } => {
    const before = Number(search.before)
    return Number.isInteger(before) && before > 1 ? { before } : {}
  },
  component: lazyRouteComponent(() => import('./features/projects/ProjectPage.tsx'), 'ProjectPage'),
})

export type ViewMode = 'side' | 'overlay' | 'diff'
export interface BuildSearch {
  /** Selected screenshot, so a link can point straight at one change. */
  shot?: string
  mode?: ViewMode
}

const buildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/builds/$number',
  validateSearch: (search: Record<string, unknown>): BuildSearch => ({
    ...(typeof search.shot === 'string' && search.shot ? { shot: search.shot } : {}),
    ...(search.mode === 'side' || search.mode === 'overlay' || search.mode === 'diff'
      ? { mode: search.mode }
      : {}),
  }),
  component: lazyRouteComponent(() => import('./features/builds/BuildPage.tsx'), 'BuildPage'),
})

// Three segments, so it can't collide with `$org/$project` (two) or a build page (four).
const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/members',
  component: lazyRouteComponent(() => import('./features/members/MembersPage.tsx'), 'MembersPage'),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/settings',
  component: lazyRouteComponent(
    () => import('./features/projects/ProjectSettingsPage.tsx'),
    'ProjectSettingsPage',
  ),
})

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account',
  component: lazyRouteComponent(() => import('./features/account/AccountPage.tsx'), 'AccountPage'),
})

const routeTree = rootRoute.addChildren([
  projectsRoute,
  projectRoute,
  buildRoute,
  membersRoute,
  settingsRoute,
  accountRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
