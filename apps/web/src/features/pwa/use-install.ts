import { usePwaStore } from '#lib/stores/pwa-store.ts'

import { currentPlatform } from './platform.ts'

/**
 * Whether this browser can install the dashboard as an app, and how to start it: the browser's own
 * prompt where it has one, the Add to Home Screen steps on an iPhone (it has no prompt).
 */
export function useInstall() {
  const installEvent = usePwaStore((s) => s.installEvent)
  const installed = usePwaStore((s) => s.installed)
  const setInstallEvent = usePwaStore((s) => s.setInstallEvent)
  const setSheetOpen = usePwaStore((s) => s.setSheetOpen)
  const platform = currentPlatform()
  const canInstall = !installed && (installEvent !== null || platform.iosSafari)

  async function install(): Promise<void> {
    if (installEvent) {
      // A prompt can be shown once; the browser offers a new one if the person declines.
      setInstallEvent(null)
      await installEvent.prompt()
      await installEvent.userChoice
    } else if (platform.iosSafari) {
      setSheetOpen(true)
    }
  }

  return { canInstall, install, mobile: platform.mobile }
}
