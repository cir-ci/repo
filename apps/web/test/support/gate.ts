import { json } from './fetch.ts'

const noop = () => {}

/**
 * A reply held back until the test lets it go: what makes "the screen changed before the server
 * answered" testable. `answer` / `refuse` send the reply; await `gate.reply` as a fakeFetch handler.
 */
export function gate() {
  let send: (response: Response) => void = noop
  const reply = new Promise<Response>((resolve) => {
    send = resolve
  })
  return {
    reply,
    answer: (body: unknown) => send(json(body)),
    refuse: (message = 'boom') => send(json({ error: message }, 500)),
  }
}
