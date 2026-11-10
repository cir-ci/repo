export namespace Flaky {
  /** Flip-flops: returns to an earlier image on the default branch, against the team's limit. */
  export interface FlipFlop {
    count: number
    /** The flip-flops the team needs before a screenshot is flaky. */
    threshold: number
    /** How many commits were looked at (up to 10). */
    window: number
    /** Each return, oldest first: build `build` showed the image build `backTo` first had. */
    returns: { build: number; backTo: number }[]
  }

  /** Rerun disagreement: runs of one commit that rendered different images. */
  export interface Reruns {
    /** The latest such commit's latest build. */
    build: number
    /** How many runs of it had an image, and how many of them differ from the most common. */
    runs: number
    differing: number
    /** How many commits in the window had runs that disagreed. */
    commits: number
  }

  /** Why a screenshot is flaky, with the evidence. `@circi/core`'s `flakyReasonText` says it in words. */
  export type Reason =
    | { kind: 'flip_flop'; flipFlop: FlipFlop }
    | { kind: 'reruns_disagree'; reruns: Reruns }
    | { kind: 'both'; flipFlop: FlipFlop; reruns: Reruns }

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
      /** Why it is flaky, with the evidence. */
      reason: Reason
    }[]
  }
}
