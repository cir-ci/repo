import { createRuntime, type Runtime } from '#lifecycle/runtime.ts'

/** Output and runtime helpers shared by the one-shot commands (`migrate`, `admin …`). */

/** A team as printed by the CLI. (The CI key is better-auth's; only its id is stored here.) */
export function publicTeam<T>(p: T): T {
  return p
}

export function printPassword(password: string): void {
  console.log('\nPassword (shown once, they can change it after signing in):')
  console.log(`  ${password}`)
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
