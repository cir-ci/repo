describe('shots', () => {
  beforeEach(() => cy.visit('app/index.html'))

  it('takes named screenshots with the plain Cypress API', () => {
    cy.screenshot('home')
    cy.get('#card').screenshot('parts/card')
    cy.get('#card').screenshot('padded', { padding: 10 })
  })

  it('clamps padding on a long page to the end of the document', () => {
    cy.visit('app/tall.html')
    cy.screenshot('tall', { padding: 5000 })
  })

  it('skips a screenshot whose name has nothing usable in it, without failing the test', () => {
    cy.screenshot('!!')
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
