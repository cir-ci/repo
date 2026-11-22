export namespace CirciOptions {
  /** One shard of a parallel build; the build is processed once all `total` shards arrive. */
  export interface Shard {
    /** 0-based. */
    index: number
    total: number
    /** Ties the shards together. Default: the CI run's ID. */
    nonce?: string
  }

  /**
   * The options every CirCI integration that writes screenshots and uploads them when it is done
   * shares (`@circi/vitest`'s reporter, `@circi/storybook`'s addon): same names, same meanings,
   * same defaults.
   */
  export interface Common {
    /** CirCI address. Default: `CIRCI_API_URL`. */
    apiUrl?: string
    /** Project CI token. Default: `CIRCI_TOKEN`. */
    token?: string
    /** Build name; give each kind of build its own. Each integration has its own default. */
    name?: string
    /** Where captures are written, relative to the project root. Default `.circi/screenshots`. */
    dir?: string
    /** Empty the captures' folder when the run starts, so a build holds only this run's captures. Default false. */
    clean?: boolean
    /** Project root to look in. Default: the working directory (Vitest: the root of the run). */
    root?: string
    /** Wait for the result and fail the run when changes need review. Default false. */
    wait?: boolean
    /** Fail the run if the upload fails. Default false. */
    strict?: boolean
    /** This process's shard, if not given on the command line. */
    shard?: Shard
    log?: (line: string) => void
  }
}
