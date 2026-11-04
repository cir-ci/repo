import { createRuntime, type Runtime } from '../runtime.ts'

/** Output and runtime helpers shared by the one-shot commands (`migrate`, `admin …`). */

/** Never print the token hash, even in JSON output. */
export function publicProject<T extends { tokenHash: string }>(p: T): Omit<T, 'tokenHash'> {
  const { tokenHash: _hash, ...rest } = p
  return rest
}

export function printToken(token: string): void {
  console.log('\nCI token (shown once, store it as the CIRCI_TOKEN secret in your CI):')
  console.log(`  ${token}`)
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

/** Runs a one-shot command with a runtime (quiet logs), closing it afterwards. */
export async function withRuntime(fn: (rt: Runtime) => Promise<void>): Promise<void> {
  const rt = createRuntime({ LOG_LEVEL: 'warn', ...process.env })
  try {
    await fn(rt)
  } finally {
    await rt.close()
  }
}
