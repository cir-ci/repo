// The same file name as ../admin/home.cy.js: the two must not share a screenshot.
describe('public home', () => {
  it('takes its hero', () => {
    cy.visit('app/index.html')
    cy.get('#card').screenshot('hero')
  })
})
