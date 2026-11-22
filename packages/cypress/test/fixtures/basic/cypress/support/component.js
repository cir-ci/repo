import '@circi/cypress/support'

// What a framework's `mount` does, without a framework: put a component's markup in the root.
Cypress.Commands.add('mount', (html) => {
  cy.get('[data-cy-root]').then(($root) => {
    $root[0].innerHTML = html
  })
})
