import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'

import { CloseIcon } from './icons.ts'
import { useRestoreFocus } from './use-restore-focus.ts'

import styles from './Dialog.module.css'

/**
 * Provisional (docs/design-gaps.md §4): a modal on Base UI's `Dialog`. 440px wide for forms
 * (`size="wide"`: 560, `size="catalog"`: 880 for a grid of choices), a 44px header with the title and a close button, and a footer for the
 * actions (primary last). Focus is trapped, Escape and a click on the backdrop close it, and
 * focus returns to what opened it.
 *
 * It renders in a portal on `document.body`, outside any wrapper that sets
 * `data-circi-color-scheme`: only the scheme on `<html>` reaches it.
 */
export function Dialog({
  title,
  description,
  size = 'form',
  actions,
  hideClose = false,
  headerEnd,
  dismissible = true,
  initialFocus,
  children,
  ...rest
}: Dialog.Props) {
  useRestoreFocus(rest.open ?? false)
  return (
    <BaseDialog.Root {...rest} disablePointerDismissal={!dismissible}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={styles.viewport}>
          <BaseDialog.Popup
            className={styles.popup}
            data-size={size}
            {...(initialFocus === undefined ? {} : { initialFocus })}
          >
            <header className={styles.header}>
              <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
              {headerEnd ? <div className={styles.headerEnd}>{headerEnd}</div> : null}
              {hideClose ? null : (
                <BaseDialog.Close className={styles.close} aria-label="Close">
                  <CloseIcon />
                </BaseDialog.Close>
              )}
            </header>
            <div className={styles.body}>
              {description ? (
                <BaseDialog.Description className={styles.description}>
                  {description}
                </BaseDialog.Description>
              ) : null}
              {children}
            </div>
            {actions ? <footer className={styles.footer}>{actions}</footer> : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export namespace Dialog {
  export interface Props extends Omit<BaseDialog.Root.Props, 'children'> {
    /** The accessible name of the dialog. */
    title: ReactNode
    /** One line under the header; becomes the dialog's accessible description. */
    description?: ReactNode
    /** `form` is 440px wide, `wide` 560px, `catalog` 880px, `image` 960px (see `ImageDialog`). */
    size?: 'form' | 'wide' | 'catalog' | 'image'
    /** The footer buttons, right-aligned; put the primary one last. */
    actions?: ReactNode
    /** Extra header content, right-aligned before the close button (the lightbox's size and switch). */
    headerEnd?: ReactNode
    /** Omit the header's close button (a dialog the user must answer). */
    hideClose?: boolean
    /** `false`: a click on the backdrop does not close it (Escape still does). */
    dismissible?: boolean
    /** What takes focus when it opens: a ref to the field to type in (default: the first control, the close button). */
    initialFocus?: BaseDialog.Popup.Props['initialFocus']
    children?: ReactNode
  }
}
