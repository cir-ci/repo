/// <reference types="cypress" />
/**
 * `import '@circi/cypress/support'` in the support file. `cy.screenshot()` keeps its signature and
 * what it yields; before a capture it waits for fonts and stops animations and the caret, and
 * what it photographs is exactly the thing and nothing around it:
 *
 * - on an element (`cy.get(sel).screenshot('x')`): the element's box;
 * - on the page: its content, as tall as the content is (not padded to the viewport), without
 *   Cypress's own interface;
 * - in component testing: the mounted component's box.
 *
 * An element with no size, or hidden, is an error rather than a blank image. `padding` adds space
 * on purpose. An explicit `capture` or `clip` is left alone.
 */
import { assertCapturable, pageTarget, settle, unsettle } from './page.ts'

Cypress.Screenshot.defaults({ capture: 'fullPage', disableTimersAndAnimations: true })

type Options = Partial<Cypress.ScreenshotOptions>

function isOptions(value: unknown): value is Options {
  return typeof value === 'object' && value !== null
}

/** The element a command was chained off (`cy.get(...)` yields a jQuery collection), if any. */
function subjectElement(subject: unknown): Element | undefined {
  if (!isOptions(subject) || !('length' in subject)) return undefined
  const first: unknown = Reflect.get(subject, '0')
  return isElement(first) ? first : undefined
}

/** Structural, not `instanceof`: the page under test is another window with its own `Element`. */
function isElement(value: unknown): value is Element {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getBoundingClientRect' in value &&
    typeof value.getBoundingClientRect === 'function'
  )
}

interface Plan {
  win: Window
  options: Options
  target: JQuery<Element> | undefined
}

// A dual command: the argument after the original is the subject (undefined on `cy`).
function screenshot(
  original: (...args: unknown[]) => unknown,
  subject: unknown,
  ...rest: unknown[]
) {
  const [first, second] = rest
  const name = typeof first === 'string' ? first : undefined
  const given: Options = (isOptions(first) ? first : isOptions(second) ? second : undefined) ?? {}
  const chained = subjectElement(subject)

  return cy
    .window({ log: false })
    .then(async (win): Promise<Plan> => {
      await settle(win)
      if (chained) {
        assertCapturable(chained)
        return { win, options: {}, target: undefined }
      }
      // An explicit `capture` or `clip` is the test's own choice.
      if (given.capture !== undefined || given.clip !== undefined) {
        return { win, options: {}, target: undefined }
      }
      const plan = pageTarget(win, Cypress.testingType, given.padding)
      return {
        win,
        options: plan.clip ? { capture: 'fullPage', clip: plan.clip } : {},
        target: plan.element ? Cypress.$(plan.element) : undefined,
      }
    })
    .then(({ win, options, target }) => {
      const merged: Options = {
        ...given,
        ...options,
        onAfterScreenshot(...args) {
          unsettle(win)
          given.onAfterScreenshot?.(...args)
        },
      }
      return original(target ?? subject, ...(name === undefined ? [merged] : [name, merged]))
    })
}

// The command types describe `cy.screenshot(name?, options?)`; the subject-first form the
// overwrite is called with isn't in them.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
Cypress.Commands.overwrite('screenshot', screenshot as never)
