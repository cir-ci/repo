import { type ReactNode, useEffect, useState } from 'react'

import { Button } from './Button.tsx'
import { Dialog } from './Dialog.tsx'
import { Kbd } from './Kbd.tsx'

import styles from './ImageDialog.module.css'

/**
 * The lightbox: a modal `Dialog` (up to 960px wide) that shows one image at a time, fitted to
 * the viewport. The header carries the caption, the image's size ("1280 × 960") and, with several
 * images, a button naming the next one; ← and → do the same. Esc, the close button or a click on
 * the scrim closes it and focus returns to what opened it.
 *
 * Controlled, like `Dialog`: the caller owns `open` and `index`. Open it from a click on the
 * image itself with `EnlargeTrigger`:
 *
 *   const [at, setAt] = useState<number | null>(null)
 *   <EnlargeTrigger label="Enlarge this build" onClick={() => setAt(1)}><img … /></EnlargeTrigger>
 *   <ImageDialog
 *     images={[{ src: baseline, caption: 'Baseline · build #1 on main', label: 'Baseline' }, { src: current, caption: 'This build · a0f30cf', label: 'This build' }]}
 *     open={at !== null}
 *     index={at ?? 0}
 *     onIndexChange={setAt}
 *     onOpenChange={(open) => { if (!open) setAt(null) }}
 *   />
 */
export function ImageDialog({
  images,
  index,
  onIndexChange,
  open,
  onOpenChange,
  hint,
}: ImageDialog.Props) {
  const count = images.length
  const at = Math.min(Math.max(index, 0), count - 1)
  const current = images[at]
  // Keep the last image while the dialog fades out, so it doesn't blank first.
  const [shown, setShown] = useState(current)
  if (current && current !== shown) setShown(current)

  useEffect(() => {
    if (!open || count < 2) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      )
        return
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      onIndexChange((index + step + count) % count)
    }
    // Capture: the dialog's own key handling stops arrow keys before they bubble to the document.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, count, index, onIndexChange])

  const image = current ?? shown
  if (!image) return null
  const other = count > 1 ? images[(at + 1) % count] : undefined
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="image"
      title={image.caption}
      headerEnd={
        <>
          {image.width && image.height ? (
            <span className={styles.size}>
              {image.width} × {image.height}
            </span>
          ) : null}
          {other ? (
            <Button size="sm" variant="ghost" onClick={() => onIndexChange((at + 1) % count)}>
              {other.label ?? other.caption} <Kbd>→</Kbd>
            </Button>
          ) : null}
        </>
      }
      actions={
        <span className={styles.hint}>
          <Kbd>Esc</Kbd> close
          {count > 1 ? (
            <>
              {' '}
              · <Kbd>←</Kbd> <Kbd>→</Kbd> switch image
            </>
          ) : null}
          {hint ? <> · {hint}</> : null}
        </span>
      }
    >
      <div className={styles.stage}>
        <div className={styles.frame}>
          <img
            className={styles.image}
            src={image.src}
            alt={image.alt ?? image.caption}
            {...(image.width ? { width: image.width } : {})}
            {...(image.height ? { height: image.height } : {})}
          />
          {image.overlay}
        </div>
      </div>
    </Dialog>
  )
}

export namespace ImageDialog {
  export interface Image {
    src: string
    /** Shown as the dialog's title: "Baseline · build #1 on main". Also the image's alt text by default. */
    caption: string
    /** The short name on the switch button while this is the other image: "Baseline". Defaults to the caption. */
    label?: string
    alt?: string
    /** Intrinsic size, if known: shown in the header, and reserves the space while it loads. */
    width?: number
    height?: number
    /**
     * Drawn over the image, exactly as big as it (the parent is positioned): a layer of regions
     * the caller owns. The dialog knows nothing of what it is.
     */
    overlay?: ReactNode
  }

  export interface Props {
    /** One or more images; with more than one the dialog switches between them. */
    images: ReadonlyArray<Image>
    /** The image shown. */
    index: number
    onIndexChange: (index: number) => void
    open: boolean
    onOpenChange: (open: boolean) => void
    /** More for the footer, after the keys: "drag to comment on a region". */
    hint?: ReactNode
  }
}
