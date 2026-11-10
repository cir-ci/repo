import { Toast as BaseToast } from '@base-ui/react/toast'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { CheckCircleIcon, CloseIcon, ErrorIcon } from './icons.ts'

import styles from './Toast.module.css'

/** How long a toast stays when nobody hovers or focuses it. */
export const TOAST_MS = 5000
/** How long an error stays: longer, so there is time to read why. */
export const TOAST_ERROR_MS = 10_000

/** The tone of a toast; carried as the toast's `data.tone`. */
export type ToastTone = 'success' | 'error'

/** The data a CirCI toast carries beside Base UI's own fields. */
export interface ToastData {
  tone: ToastTone
}

/** A manager to add and close toasts from outside React; hand it to `ToastProvider`. */
export type ToastManager = ReturnType<typeof createToastManager>

export function createToastManager() {
  return BaseToast.createToastManager<ToastData>()
}

/**
 * Provisional: the context the toasts live in. Toasts close by themselves after 5 seconds
 * (errors after 10, set per toast), pause while hovered or focused, and stack three at most.
 */
export function ToastProvider({ manager, children }: ToastProvider.Props) {
  return (
    <BaseToast.Provider toastManager={manager} timeout={TOAST_MS} limit={3}>
      {children}
    </BaseToast.Provider>
  )
}

export namespace ToastProvider {
  export interface Props {
    manager: ToastManager
    children?: ReactNode
  }
}

/**
 * Provisional: where the toasts appear, at the foot of the page. The viewport is one polite live
 * region named "Notifications", so a screen reader hears each toast once as it arrives (do not
 * also `announce` its message). Rendered once, inside `ToastProvider`.
 */
export function ToastViewport({ className }: ToastViewport.Props) {
  const { toasts } = BaseToast.useToastManager<ToastData>()
  return (
    <BaseToast.Viewport className={cx(styles.viewport, className)}>
      {toasts.map((toast) => (
        <BaseToast.Root
          key={toast.id}
          toast={toast}
          swipeDirection="down"
          data-tone={toast.data?.tone ?? 'success'}
          className={styles.root}
        >
          {toast.data?.tone === 'error' ? (
            <ErrorIcon className={styles.icon} />
          ) : (
            <CheckCircleIcon className={styles.icon} />
          )}
          <BaseToast.Content className={styles.content}>
            <BaseToast.Title className={styles.title} />
          </BaseToast.Content>
          {toast.actionProps ? <BaseToast.Action className={styles.action} /> : null}
          {/* The stack is flat (never collapsed), so the button is always reachable. */}
          <BaseToast.Close className={styles.close} aria-label="Dismiss" aria-hidden={false}>
            <CloseIcon />
          </BaseToast.Close>
        </BaseToast.Root>
      ))}
    </BaseToast.Viewport>
  )
}

export namespace ToastViewport {
  export interface Props {
    className?: string
  }
}
