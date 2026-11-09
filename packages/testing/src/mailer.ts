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
    /** Stands in for the SMTP check: resolves, or rejects with `verifyError` when set. */
    verify(): Promise<void>
    /** Makes `verify` reject with this error (as a mail server that refuses the login would). */
    verifyError?: Error
    /** How many times `verify` ran (it never sends). */
    verified: number
    /** Resolves when every send started so far has finished. */
    idle(): Promise<void>
  }
}

/** The SMTP fake: remembers each mail instead of sending it. Fits `Mailer` from `@circi/auth`. */
export function fakeMailer(): fakeMailer.Result {
  const sent: fakeMailer.Mail[] = []
  const pending = new Set<Promise<void>>()
  const mailer: fakeMailer.Result = {
    sent,
    verified: 0,
    async verify() {
      mailer.verified += 1
      if (mailer.verifyError) throw mailer.verifyError
    },
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
  return mailer
}
