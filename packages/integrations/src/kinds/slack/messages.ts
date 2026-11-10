/**
 * The messages CirCI posts to Slack, as pure functions: a plain `text` (what notifications and
 * screen readers show) and Block Kit `blocks`. Nothing here talks to Slack.
 *
 * Slack's mrkdwn treats `&`, `<` and `>` as control characters, so every piece of text that
 * comes from a person (a branch, a reviewer's name, a rejection reason) goes through
 * `escapeMrkdwn`. Long text is cut with `truncate`: a section block holds at most 3000 characters.
 */

export namespace SlackMessage {
  /** The build a message is about. */
  export interface Build {
    teamName: string
    number: number
    branch?: string | null
    /** The build's page in the dashboard. */
    url: string
  }

  export interface Block {
    type: string
    [key: string]: unknown
  }

  export interface Message {
    text: string
    blocks: Block[]
  }

  export interface ReviewRequested {
    build: Build
    /** Who was asked. */
    reviewer: string
    /** Who asked; absent when a rule or the rotation did. */
    requestedBy?: string | null
    /** The reviewer was asked before and the request had closed. */
    again?: boolean
    dueAt?: Date | null
  }

  export interface ReviewOverdue {
    build: Build
    reviewer: string
    dueAt?: Date | null
  }

  export interface Decision {
    build: Build
    /** Who decided. */
    reviewer: string
  }

  export interface Rejected extends Decision {
    reason?: string | null
  }
}

/** Longest rejection reason shown; the full text stays in CirCI. */
export const SLACK_REASON_MAX = 500
const NAME_MAX = 100

/** Escapes the three characters Slack's mrkdwn gives meaning to. */
export const escapeMrkdwn = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Cuts text to `max` characters (counting code points), ending in an ellipsis when it was cut. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`
}

/** A Slack link: `<url|label>`, both parts made safe. */
const link = (url: string, label: string) =>
  `<${url.replaceAll('&', '&amp;').replaceAll('<', '%3C').replaceAll('>', '%3E').replaceAll('|', '%7C')}|${escapeMrkdwn(label)}>`

const person = (name: string) =>
  escapeMrkdwn(truncate(name.replaceAll(/\s+/g, ' ').trim(), NAME_MAX))

const buildLabel = (b: SlackMessage.Build) => `${b.teamName} #${b.number}`

const buildLink = (b: SlackMessage.Build) =>
  link(b.url, truncate(`${b.teamName} #${b.number}`, 150))

const branchText = (b: SlackMessage.Build) =>
  b.branch ? ` on \`${escapeMrkdwn(truncate(b.branch, 100)).replaceAll('`', "'")}\`` : ''

const section = (text: string): SlackMessage.Block => ({
  type: 'section',
  text: { type: 'mrkdwn', text: truncate(text, 3000) },
})

const openButton = (url: string): SlackMessage.Block => ({
  type: 'actions',
  elements: [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Open build' },
      url,
      action_id: 'open_build',
    },
  ],
})

/** Slack's date token, so each reader sees the time in their own zone. */
const dueText = (dueAt: Date | null | undefined) => {
  if (!dueAt || Number.isNaN(dueAt.getTime())) return ''
  const unix = Math.floor(dueAt.getTime() / 1000)
  return `<!date^${unix}^{date_short_pretty} at {time}|${dueAt.toISOString()}>`
}

function message(text: string, lines: string[], url: string): SlackMessage.Message {
  return { text, blocks: [section(lines.join('\n')), openButton(url)] }
}

export function reviewRequestedMessage(input: SlackMessage.ReviewRequested): SlackMessage.Message {
  const { build } = input
  const who = person(input.reviewer)
  const by = input.requestedBy ? `${person(input.requestedBy)} asked ` : 'Asked '
  const due = dueText(input.dueAt)
  const lines = [
    `:eyes: *${input.again ? 'Review requested again' : 'Review requested'}*`,
    `${by}*${who}* to ${input.again ? 'look again at' : 'review'} ${buildLink(build)}${branchText(build)}.`,
  ]
  if (due) lines.push(`Due ${due}`)
  return message(
    `${input.again ? 'Review requested again' : 'Review requested'}: ${buildLabel(build)} (${input.reviewer.slice(0, NAME_MAX)})`,
    lines,
    build.url,
  )
}

export function reviewOverdueMessage(input: SlackMessage.ReviewOverdue): SlackMessage.Message {
  const { build } = input
  const due = dueText(input.dueAt)
  const lines = [
    ':hourglass_flowing_sand: *Review overdue*',
    `*${person(input.reviewer)}*'s review of ${buildLink(build)}${branchText(build)} is overdue.`,
  ]
  if (due) lines.push(`It was due ${due}`)
  return message(`Review overdue: ${buildLabel(build)}`, lines, build.url)
}

export function buildRejectedMessage(input: SlackMessage.Rejected): SlackMessage.Message {
  const { build } = input
  const lines = [
    ':x: *Changes rejected*',
    `*${person(input.reviewer)}* rejected the changes in ${buildLink(build)}${branchText(build)}.`,
  ]
  const reason = input.reason?.trim()
  if (reason) {
    lines.push(
      truncate(reason, SLACK_REASON_MAX)
        .split('\n')
        .map((l) => `> ${escapeMrkdwn(l)}`)
        .join('\n'),
    )
  }
  return message(`Changes rejected: ${buildLabel(build)}`, lines, build.url)
}

export function buildApprovedMessage(input: SlackMessage.Decision): SlackMessage.Message {
  const { build } = input
  return message(
    `Changes approved: ${buildLabel(build)}`,
    [
      ':white_check_mark: *Changes approved*',
      `*${person(input.reviewer)}* approved the changes in ${buildLink(build)}${branchText(build)}.`,
    ],
    build.url,
  )
}
