import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

/**
 * Makes the app icons in `public/icons` from the logo (`src/features/auth/logo.svg`, a full
 * maroon tile): `pnpm --filter @circi/web icons`. The PNGs are committed, so a build needs no
 * image tooling; run this again when the logo changes.
 *
 *   192.png, 512.png          "any": the logo as it is (a full square, the OS rounds it)
 *   180.png                   the Apple touch icon, the same
 *   512-maskable.png          the logo at 72% on the logo's maroon, so a round mask keeps the ears
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const MAROON = { r: 114, g: 64, b: 57, alpha: 1 }
const MASKABLE_SCALE = 0.72

const svg = await readFile(here('../src/features/auth/logo.svg'))
const tile = (size: number) => sharp(svg, { density: 300 }).resize(size, size).png().toBuffer()

await Promise.all(
  [180, 192, 512].map(async (size) =>
    writeFile(here(`../public/icons/${size}.png`), await tile(size)),
  ),
)

const canvas = 512
const inner = Math.round(canvas * MASKABLE_SCALE)
const offset = Math.round((canvas - inner) / 2)
await writeFile(
  here('../public/icons/512-maskable.png'),
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: MAROON } })
    .composite([{ input: await tile(inner), left: offset, top: offset }])
    .png()
    .toBuffer(),
)
