import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPO_ROOT = join(E2E_ROOT, '..')
export const ARTIFACTS_DIR = join(E2E_ROOT, '.artifacts')
export const COMPOSE_FILE = join(E2E_ROOT, 'compose.yml')
export const CLI_MAIN = join(REPO_ROOT, 'packages', 'cli', 'dist', 'main.mjs')
