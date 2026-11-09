import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  githubAppNote,
  githubAppQuery,
  githubSourceNote,
  githubStep,
} from '#features/instance/github-app-api.ts'
import { fakeFetch, restoreFetch } from '#test/support/fetch.ts'

afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

describe('githubStep', () => {
  it('installs when the instance has an App, however it was set up', () => {
    expect(githubStep({ source: 'env', canManage: false })).toBe('install')
    expect(githubStep({ source: 'manifest', canManage: true })).toBe('install')
  })

  it('sends an instance admin to set one up, and asks anyone else to ask them', () => {
    expect(githubStep({ source: 'none', canManage: true })).toBe('set-up')
    expect(githubStep({ source: 'none', canManage: false })).toBe('ask-admin')
  })
})

describe('notes', () => {
  it('says where the App came from, and what a failed return means', () => {
    expect(githubSourceNote({ source: 'env' })).toMatch(/environment/)
    expect(githubSourceNote({ source: 'manifest' })).toMatch(/stored encrypted/)
    expect(githubSourceNote({ source: 'none' })).toBe('Not set up yet.')
    expect(githubAppNote('failed')).toMatch(/start again/)
    expect(githubAppNote(undefined)).toBeNull()
  })
})

describe('githubAppQuery', () => {
  it('reads the instance’s GitHub App', async () => {
    const app = { source: 'none', canManage: true }
    fakeFetch({ 'GET /api/instance/github-app': app })
    expect(await new QueryClient().fetchQuery(githubAppQuery())).toEqual(app)
  })
})
