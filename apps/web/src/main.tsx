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
import { dismissBootScreen } from './lib/boot-screen.ts'
import { isInstalled } from './lib/document-title.ts'

startPwa()
// Before the router's first redirect drops the launch address (`?source=pwa`): a launch as the app
// is remembered for the session, so full screen (the manifest's first choice) keeps the app's tabs.
isInstalled()

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')
createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)

// A safety net: the app dismisses the loading screen as soon as it has drawn (lib/boot-screen.ts);
// if it never does (an error before the first page), the screen still goes.
setTimeout(dismissBootScreen, 8000)
