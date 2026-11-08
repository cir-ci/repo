export namespace Flaky {
  /** Screenshots that keep changing on the default branch, where nobody reviews them. */
  export interface Report {
    /** How many recent default-branch builds were looked at. */
    builds: number
    flaky: { name: string; changedIn: number }[]
  }
}
