/**
 * What the settings page calls a device that takes push, from its browser's `User-Agent`:
 * "Chrome on Android", "Safari on iPhone". Only what a person recognises their own device by;
 * the exact string is stored beside it.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : undefined
  // Order matters: Edge, Opera and Samsung's browser also say Chrome; Chrome also says Safari;
  // Chrome and Firefox on iOS say CriOS and FxiOS.
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : undefined
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'Unknown device'
}
