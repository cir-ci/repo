describe('shots', () => {
  beforeEach(() => cy.visit('app/index.html'))

  it('takes named screenshots with the plain Cypress API', () => {
    cy.screenshot('home')
    cy.get('#card').screenshot('parts/card')
    cy.get('#card').screenshot('padded', { padding: 10 })
  })

  it('leaves unnamed screenshots out', () => {
    cy.screenshot()
  })

  it('refuses an element that has nothing to show', (done) => {
    cy.on('fail', (error) => {
      expect(error.message).to.contain('nothing to capture')
      done()
    })
    cy.get('#hidden').screenshot('hidden')
  })
})
