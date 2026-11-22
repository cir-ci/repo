describe('failing', () => {
  it('fails, and Cypress takes its own screenshot', () => {
    cy.visit('app/index.html')
    cy.screenshot('before-failure').then(() => {
      expect(1).to.equal(2)
    })
  })
})
