// Fonts ship with the app: a self-hosted install may have no route to a font service.
// oxlint-disable-next-line import/no-unassigned-import
import '@fontsource-variable/inter'
// oxlint-disable-next-line import/no-unassigned-import
import '@fontsource-variable/jetbrains-mono'
// The token variables and the base reset load first, from boot.ts (see index.html).
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Providers } from './app/providers.tsx'
import { router } from './app/router.tsx'
import { startPwa } from './features/pwa/start.ts'

startPwa()

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')
createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
