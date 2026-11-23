export interface RenderState {
  state: 'done' | 'error'
  message?: string
}

export interface Measure {
  /** The box to capture in page coordinates, or null when nothing visible was rendered. */
  box: { x: number; y: number; width: number; height: number } | null
  /** The selector given matched nothing. */
  missing?: boolean
  pageWidth: number
  pageHeight: number
}

export function disableMotion(css: string): void
export function trackErrors(): void
export function readRenderState(): RenderState | undefined
export function readStoryContext(): { parameters: unknown; globals: unknown }
export function settle(): Promise<void>
export function measureStory(selector: string | null): Measure
