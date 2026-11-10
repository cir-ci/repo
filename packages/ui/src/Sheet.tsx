import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'

import { CloseIcon } from './icons.ts'

import styles from './Sheet.module.css'

/**
 * A bottom sheet for phones, on Base UI's `Dialog`: it slides up from the bottom edge, rounds its
 * top corners, has a grabber, a 44px header (the title, `headerEnd`, and a 44px Close), a body that
 * scrolls and an optional pinned `footer` above the home indicator. Focus is trapped, Escape or a
 * tap on the scrim closes it, and focus returns to what opened it. `size`: `auto` is as tall as its
 * content (at most 85% of the screen), `tall` 85%, `full` the whole screen (search).
 *
 * It renders in a portal on `document.body`, outside any wrapper that sets
 * `data-circi-color-scheme`: only the scheme on `<html>` reaches it.
 */
export function Sheet({
  title,
  hideTitle = false,
  size = 'auto',
  headerEnd,
  footer,
  hideClose = false,
  initialFocus,
  children,
  ...rest
}: Sheet.Props) {
  return (
    <BaseDialog.Root {...rest}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={styles.viewport}>
          <BaseDialog.Popup
            className={styles.popup}
            data-size={size}
            {...(initialFocus === undefined ? {} : { initialFocus })}
          >
            <span className={styles.grabber} aria-hidden="true" />
            <header className={styles.header} data-hidden={hideTitle ? '' : undefined}>
              <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
              {headerEnd ? <div className={styles.headerEnd}>{headerEnd}</div> : null}
              {hideClose ? null : (
                <BaseDialog.Close className={styles.close} aria-label="Close">
                  <CloseIcon />
                </BaseDialog.Close>
              )}
            </header>
            <div className={styles.body} data-footer={footer ? '' : undefined}>
              {children}
            </div>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export namespace Sheet {
  export interface Props extends Omit<BaseDialog.Root.Props, 'children'> {
    /** The accessible name and the header's text. */
    title: ReactNode
    /** Keep the title for screen readers only (the sheet's content already says what it is). */
    hideTitle?: boolean
    size?: 'auto' | 'tall' | 'full'
    /** Extra header content before the Close button. */
    headerEnd?: ReactNode
    /** Pinned under the scrolling body (actions); it clears the home indicator. */
    footer?: ReactNode
    /** Omit the Close button (a sheet that has its own Cancel). */
    hideClose?: boolean
    /** What takes focus when it opens (default: the first control). */
    initialFocus?: BaseDialog.Popup.Props['initialFocus']
    children?: ReactNode
  }
}
