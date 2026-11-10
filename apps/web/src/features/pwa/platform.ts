/**
 * What kind of device this is, for the install offer. A pure function of what the browser says,
 * so it is tested without one; `currentPlatform` reads the real browser.
 */

export interface PlatformFacts {
  userAgent: string
  /** `navigator.maxTouchPoints`: an iPad asks for desktop sites and says it is a Mac. */
  maxTouchPoints: number
  /** Opened from the Home Screen or as an installed app window. */
  standalone: boolean
}

export interface Platform {
  /** A phone or tablet: the offer says "home screen" rather than "its own window". */
  mobile: boolean
  /** iPhone or iPad: no install prompt, and push only from the Home Screen. */
  ios: boolean
  /** Safari on iOS: the only iOS browser that can add to the Home Screen with these steps. */
  iosSafari: boolean
  standalone: boolean
}

export function detectPlatform(facts: PlatformFacts): Platform {
  const ua = facts.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && facts.maxTouchPoints > 1)
  // Chrome, Firefox, Edge and Opera on iOS say so; they can't add to the Home Screen the same way.
  const iosSafari = ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return { mobile: ios || /Android/.test(ua), ios, iosSafari, standalone: facts.standalone }
}

/** The browser this page runs in. */
export function currentPlatform(): Platform {
  let standalone = false
  try {
    standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Safari's own flag for a page opened from the Home Screen.
      ('standalone' in navigator && navigator.standalone === true)
  } catch {
    // No matchMedia: not installed as far as we can tell.
  }
  return detectPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone,
  })
}
