/** What Vite puts on `import.meta.env` that the app reads. */
interface ImportMeta {
  readonly env: {
    /** True in a production build, false in `vite dev`. */
    readonly PROD: boolean
  }
}
