import { SETUP_STEPS, stepLabel } from './setup-model.ts'

import styles from './Setup.module.css'

/** "Step 2 of 4" and a bar of four segments, the ones up to this step filled. */
export function SetupProgress({ step }: SetupProgress.Props) {
  return (
    <div className={styles.progress}>
      <span className={styles.label}>{stepLabel(step)}</span>
      <div className={styles.bar} aria-hidden="true">
        {SETUP_STEPS.map((name, index) => (
          <span
            key={name}
            className={index < step ? `${styles.segment} ${styles.reached}` : styles.segment}
          />
        ))}
      </div>
    </div>
  )
}

export namespace SetupProgress {
  export interface Props {
    /** The step shown, from 1. */
    step: number
  }
}
