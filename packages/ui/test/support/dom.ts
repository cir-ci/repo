/** Resolves on the next animation frame (what a render, an effect or a layout observer needs to land). */
export const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
