import { useEffect, useState } from 'react'

import { Button } from './Button.tsx'
import { Dialog } from './Dialog.tsx'
import { ChevronLeftIcon, ChevronRightIcon } from './icons.ts'
import { Link } from './Link.tsx'

import styles from './ImageDialog.module.css'

/**
 * The lightbox: a modal `Dialog` (up to 960px wide) that shows one image at a time, fitted to
 * the viewport, under its caption. Esc, the close button or a click on the scrim closes it and
 * focus returns to what opened it. With several images, ← and → (and the two buttons) switch
 * between them in place; "Open full size" is a secondary link to the file in a new tab.
 *
 * Controlled, like `Dialog`: the caller owns `open` and `index`. Open it from a click on the
 * image itself with `EnlargeTrigger`:
 *
 *   const [at, setAt] = useState<number | null>(null)
 *   <EnlargeTrigger label="Enlarge this build" onClick={() => setAt(1)}><img … /></EnlargeTrigger>
 *   <ImageDialog
 *     images={[{ src: baseline, caption: 'Baseline · build #1 on main' }, { src: current, caption: 'This build · a0f30cf' }]}
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
}: ImageDialog.Props) {
  const count = images.length
  const current = images[Math.min(Math.max(index, 0), count - 1)]
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
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="image"
      title={image.caption}
      actions={
        <Link href={image.src} target="_blank">
          Open full size
        </Link>
      }
    >
      <div className={styles.stage}>
        <img
          className={styles.image}
          src={image.src}
          alt={image.alt ?? image.caption}
          {...(image.width ? { width: image.width } : {})}
          {...(image.height ? { height: image.height } : {})}
        />
      </div>
      {count > 1 ? (
        <div className={styles.switcher}>
          <Button
            size="sm"
            variant="ghost"
            leading={<ChevronLeftIcon />}
            onClick={() => onIndexChange((index - 1 + count) % count)}
          >
            Previous image
          </Button>
          <span className={styles.position}>
            {Math.min(Math.max(index, 0), count - 1) + 1} of {count} · use ← and → to switch
          </span>
          <Button
            size="sm"
            variant="ghost"
            leading={<ChevronRightIcon />}
            onClick={() => onIndexChange((index + 1) % count)}
          >
            Next image
          </Button>
        </div>
      ) : null}
    </Dialog>
  )
}

export namespace ImageDialog {
  export interface Image {
    src: string
    /** Shown as the dialog's title: "Baseline · build #1 on main". Also the image's alt text by default. */
    caption: string
    alt?: string
    /** Intrinsic size, if known: reserves the space while it loads. */
    width?: number
    height?: number
  }

  export interface Props {
    /** One or more images; with more than one the dialog switches between them. */
    images: ReadonlyArray<Image>
    /** The image shown. */
    index: number
    onIndexChange: (index: number) => void
    open: boolean
    onOpenChange: (open: boolean) => void
  }
}
