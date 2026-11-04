import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material'
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'

import { RouterLink } from './components.tsx'
import { BuildPage } from './pages/Build.tsx'
import { ProjectPage } from './pages/Project.tsx'
import { ProjectsPage } from './pages/Projects.tsx'

function Layout() {
  return (
    <>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar variant="dense">
          <RouterLink
            to="/"
            underline="none"
            color="inherit"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
          >
            <Box
              aria-hidden
              sx={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: 4,
                borderColor: 'primary.main',
                borderRightColor: 'transparent',
              }}
            />
            <Typography sx={{ fontWeight: 700 }}>CirCI</Typography>
          </RouterLink>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Outlet />
      </Container>
    </>
  )
}

function NotFound() {
  return (
    <Box>
      <Typography variant="h1">Page not found</Typography>
      <RouterLink to="/">Back to projects</RouterLink>
    </Box>
  )
}

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound })

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProjectsPage,
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project',
  component: ProjectPage,
})

const buildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/builds/$number',
  component: BuildPage,
})

const routeTree = rootRoute.addChildren([projectsRoute, projectRoute, buildRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
