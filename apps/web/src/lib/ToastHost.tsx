import { ToastProvider, ToastViewport } from '@circi/ui'

import { toastManager } from '#lib/stores/toast-store.ts'

/** The one place toasts are drawn, at the foot of the page; mounted once around the app. */
export function ToastHost() {
  return (
    <ToastProvider manager={toastManager}>
      <ToastViewport />
    </ToastProvider>
  )
}
