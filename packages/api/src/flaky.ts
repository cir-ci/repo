export namespace Flaky {
  /**
   * Screenshots whose image keeps coming back to an earlier one on the default branch, or that
   * differ across runs of one commit.
   */
  export interface Report {
    /** How many recent default-branch commits were looked at. */
    builds: number
    flaky: {
      name: string
      /** In how many of those commits it showed as changed. */
      changedIn: number
      /** Why, in words: "came back to an earlier image 3 times". */
      reason: string
    }[]
  }
}
