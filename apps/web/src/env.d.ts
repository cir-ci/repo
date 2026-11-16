/** What Vite puts on `import.meta.env` that the app reads. */
interface ImportMeta {
  readonly env: {
    /** True in a production build, false in `vite dev`. */
    readonly PROD: boolean
  }
}

/** An identifier of this build (vite.config.ts `define`); the service worker's manifest carries the same. Not defined in tests. */
declare const CIRCI_BUILD_ID: string
