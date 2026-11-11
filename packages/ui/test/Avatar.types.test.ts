import { describe, expect, it } from 'vitest'

import type { Avatar } from '../src/Avatar.tsx'

/*
 * Each type of avatar knows what it needs. These are checked by `tsc` (`pnpm typecheck`): a
 * `@ts-expect-error` that stops erroring fails the build, so a prop quietly turning optional
 * fails here.
 */
const accept = (_props: Avatar.Props) => {}

function cases() {
  // What each type needs compiles.
  accept({ type: 'user', id: 'u1', name: 'Ada', image: null })
  accept({ type: 'user', id: 'u1', name: 'Ada', image: '/ada.png', size: 32 })
  accept({ type: 'project', slug: 'web', name: 'Web', color: 'plum', icon: null })
  accept({ type: 'project', slug: 'web', name: 'Web', color: 'plum', icon: 'rocket', size: 40 })
  accept({ type: 'workspace', slug: 'acme', name: 'Acme', picture: null })

  // A user without an ID, a name or the image field.
  // @ts-expect-error `id` is required
  accept({ type: 'user', name: 'Ada', image: null })
  // @ts-expect-error `name` is required
  accept({ type: 'user', id: 'u1', image: null })
  // @ts-expect-error `image` is required (null when there is none)
  accept({ type: 'user', id: 'u1', name: 'Ada' })

  // A project without a colour, an icon field or a slug.
  // @ts-expect-error `color` is required
  accept({ type: 'project', slug: 'web', name: 'Web', icon: null })
  // @ts-expect-error `icon` is required (null when there is none)
  accept({ type: 'project', slug: 'web', name: 'Web', color: 'plum' })
  // @ts-expect-error `slug` is required
  accept({ type: 'project', name: 'Web', color: 'plum', icon: null })
  // @ts-expect-error a colour outside the project palette
  accept({ type: 'project', slug: 'web', name: 'Web', color: 'teal', icon: null })

  // A workspace without its picture field or slug.
  // @ts-expect-error `picture` is required (null when there is none)
  accept({ type: 'workspace', slug: 'acme', name: 'Acme' })
  // @ts-expect-error `slug` is required
  accept({ type: 'workspace', name: 'Acme', picture: null })

  // One type's identity doesn't stand in for another's.
  // @ts-expect-error a project is seeded by its slug, not an ID
  accept({ type: 'project', id: 'web', name: 'Web', color: 'plum', icon: null })
  // @ts-expect-error a user has no colour
  accept({ type: 'user', id: 'u1', name: 'Ada', image: null, color: 'plum' })
  // @ts-expect-error there is no seed fallback
  accept({ type: 'user', id: 'u1', name: 'Ada', image: null, seed: 'x' })
  // @ts-expect-error the type is required
  accept({ id: 'u1', name: 'Ada', image: null })
}

describe('Avatar props', () => {
  it('are checked by the type checker (see the @ts-expect-error cases above)', () => {
    expect(cases).toBeTypeOf('function')
  })
})
