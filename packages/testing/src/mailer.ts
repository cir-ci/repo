export namespace fakeMailer {
  export interface Mail {
    to: string
    subject: string
    text: string
  }

  export interface Result {
    /** Every mail "sent", in order. */
    sent: Mail[]
    send(mail: Mail): Promise<void>
    /** Resolves when every send started so far has finished. */
    idle(): Promise<void>
  }
}

/** The SMTP fake: remembers each mail instead of sending it. Fits `Mailer` from `@circi/auth`. */
export function fakeMailer(): fakeMailer.Result {
  const sent: fakeMailer.Mail[] = []
  const pending = new Set<Promise<void>>()
  return {
    sent,
    send(mail) {
      const p = Promise.resolve().then(() => {
        sent.push(mail)
      })
      pending.add(p)
      void p.finally(() => pending.delete(p))
      return p
    },
    async idle() {
      await Promise.all(pending)
    },
  }
}
