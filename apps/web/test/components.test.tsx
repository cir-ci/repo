import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { buildState, ErrorState } from '../src/components.tsx'
import { HttpError } from '../src/lib/http.ts'
import { Row, Section } from '../src/primitives/Rows.tsx'

afterEach(cleanup)

const state = (over: Partial<Parameters<typeof buildState>[0]>) =>
  buildState({
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
    ...over,
  })

describe('buildState', () => {
  it('names each stage of a build’s life', () => {
    expect(state({ status: 'processing', conclusion: null }).label).toMatch(/process/i)
    expect(state({ status: 'error', conclusion: null }).tone).toBe('danger')
    expect(state({ conclusion: 'no_changes' }).label).toMatch(/no changes/i)
    expect(state({}).label).toMatch(/review/i)
    expect(state({ reviewStatus: 'approved' }).label).toMatch(/approved/i)
    expect(state({ reviewStatus: 'rejected' }).label).toMatch(/rejected/i)
  })
})

describe('ErrorState', () => {
  it('says "not found" in the page’s own words for a 404', () => {
    render(<ErrorState error={new HttpError(404, 'nope')} notFound="This project doesn’t exist" />)
    expect(screen.getByText('This project doesn’t exist')).toBeTruthy()
  })

  it('shows the message and offers a retry for other errors', () => {
    let retried = false
    render(<ErrorState error={new Error('boom')} onRetry={() => (retried = true)} />)
    expect(screen.getByText(/boom/)).toBeTruthy()
    screen.getByRole('button', { name: /try again|retry/i }).click()
    expect(retried).toBe(true)
  })
})

describe('Section and Row', () => {
  it('lists rows under a titled heading with a count', () => {
    render(
      <Section title="Members" count={2}>
        <Row primary="Ann" secondary="ann@acme.test · owner" />
        <Row primary="Bob" secondary="bob@acme.test" action={<button>Remove</button>} />
      </Section>,
    )
    expect(screen.getByRole('heading', { name: 'Members (2)' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })
})
