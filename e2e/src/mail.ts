/**
 * A client for Mailpit's HTTP API (https://mailpit.axllent.org/docs/api-v1/): the stack's SMTP
 * server catches everything CirCI sends.
 */

export interface MailAddress {
  Name: string
  Address: string
}

export interface MailSummary {
  ID: string
  Subject: string
  From: MailAddress
  To: MailAddress[]
  Created: string
  Snippet: string
}

export interface MailMessage extends MailSummary {
  Text: string
  HTML: string
}

export interface WaitForMail {
  /** Recipient address. */
  to: string
  /** Substring or pattern the subject must match. */
  subject?: string | RegExp
  /** Only messages created after this moment (default: any). */
  after?: Date
  timeoutMs?: number
}

export class Mailbox {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init)
    if (!res.ok) throw new Error(`Mailpit ${path}: HTTP ${res.status}`)
    return (await res.json()) as T
  }

  async messages(): Promise<MailSummary[]> {
    const data = await this.#json<{ messages: MailSummary[] | null }>('/api/v1/messages?limit=200')
    return data.messages ?? []
  }

  async message(id: string): Promise<MailMessage> {
    return this.#json<MailMessage>(`/api/v1/message/${encodeURIComponent(id)}`)
  }

  async clear(): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/messages`, { method: 'DELETE' })
  }

  /** Every message to `to`, newest first. */
  async to(address: string): Promise<MailSummary[]> {
    const data = await this.#json<{ messages: MailSummary[] | null }>(
      `/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=200`,
    )
    return data.messages ?? []
  }

  /** Waits for a message to an address (polling), then returns it in full. */
  async waitFor(options: WaitForMail): Promise<MailMessage> {
    const deadline = Date.now() + (options.timeoutMs ?? 30_000)
    const matches = (m: MailSummary) => {
      if (options.after && new Date(m.Created) <= options.after) return false
      const subject = options.subject
      if (subject === undefined) return true
      return typeof subject === 'string' ? m.Subject.includes(subject) : subject.test(m.Subject)
    }
    for (;;) {
      const found = (await this.to(options.to)).find(matches)
      if (found) return this.message(found.ID)
      if (Date.now() > deadline) {
        const seen = (await this.messages()).map(
          (m) => `${m.To.map((t) => t.Address).join(',')}: ${m.Subject}`,
        )
        throw new Error(
          `No mail to ${options.to} within ${options.timeoutMs ?? 30_000} ms. Mailbox holds: ${JSON.stringify(seen)}`,
        )
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

/** The first standalone 6-digit code in a message (the sign-in code). */
export function extractCode(message: Pick<MailMessage, 'Text' | 'HTML'>): string {
  const match =
    /(?<![\d#])(\d{6})(?!\d)/.exec(message.Text) ?? /(?<![\d#])(\d{6})(?!\d)/.exec(message.HTML)
  if (!match?.[1]) throw new Error(`No 6-digit code in the mail:\n${message.Text}`)
  return match[1]
}

/** Every http(s) link in a message, from both parts, without duplicates. */
export function extractLinks(message: Pick<MailMessage, 'Text' | 'HTML'>): string[] {
  const found = new Set<string>()
  for (const m of message.HTML.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    if (m[1]) found.add(m[1].replaceAll('&amp;', '&'))
  }
  for (const m of message.Text.matchAll(/https?:\/\/[^\s<>"')]+/g)) found.add(m[0])
  return [...found]
}
