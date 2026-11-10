import { useEffect, useState } from 'react'

import { Logo } from '#features/auth/Logo.tsx'

import styles from './WindowTitleBar.module.css'

/** The page's title as the browser has it, followed as pages change it. */
function useTitle(): string {
  const [title, setTitle] = useState(() => document.title)
  useEffect(() => {
    const observer = new MutationObserver(() => setTitle(document.title))
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [])
  return title
}

/**
 * The installed app's own title bar. In the manifest's window-controls-overlay mode the browser
 * hides its title bar (and its extension and app icons) and leaves only the window's controls;
 * this bar fills the rest of that strip with the logo and the page's title, and the window drags
 * by it. Outside that mode it isn't shown.
 */
export function WindowTitleBar() {
  const title = useTitle()
  return (
    <div className={styles.root} aria-hidden="true">
      <Logo size={16} />
      <span className={styles.title}>{title}</span>
    </div>
  )
}
