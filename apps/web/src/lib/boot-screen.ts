/**
 * The loading screen index.html draws before any script (`#circi-boot`, styled by src/boot.css)
 * stays above the app until the app has drawn the same logo in the same place, then goes: removing
 * it earlier would show a frame without the logo while the app's image decodes.
 */
export function dismissBootScreen(): void {
  document.getElementById('circi-boot')?.remove()
}

/** Dismisses the loading screen once `img` is decoded and painted. */
export function dismissBootScreenAfter(img: HTMLImageElement | null | undefined): void {
  const decoded = img ? img.decode().catch(() => undefined) : Promise.resolve()
  void decoded.then(() => requestAnimationFrame(() => requestAnimationFrame(dismissBootScreen)))
}
