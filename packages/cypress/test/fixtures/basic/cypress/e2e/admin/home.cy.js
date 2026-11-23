// The same file name as ../public/home.cy.js: the two must not share a screenshot.
describe('admin home', () => {
  it('takes its hero', () => {
    cy.visit('app/index.html')
    cy.get('#header').screenshot('hero')
  })
})
