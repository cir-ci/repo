/**
 * The element that scrolls the page: the content panel (`main#content`) in the compact layout
 * (a phone, where the panel scrolls so the bottom bar stays out of the scrollbar), the window
 * everywhere else.
 */
export function pageScroller(): HTMLElement | Window {
  const panel = document.getElementById('content')
  if (panel && /auto|scroll/.test(getComputedStyle(panel).overflowY)) return panel
  return window
}

/** How far the page is scrolled. */
export function pageScrollTop(): number {
  const scroller = pageScroller()
  return scroller instanceof Window ? scroller.scrollY : scroller.scrollTop
}

/** Scrolls the page to `top`. */
export function scrollPageTo(top: number): void {
  pageScroller().scrollTo({ top })
}
