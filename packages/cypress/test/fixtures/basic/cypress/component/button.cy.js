describe('button', () => {
  it('is taken at its own size, not the viewport', () => {
    cy.mount(
      '<button style="display: block; width: 120px; height: 40px; margin: 30px">Save</button>',
    )
    cy.screenshot('button/primary')
  })

  it('refuses when nothing is mounted', (done) => {
    cy.on('fail', (error) => {
      expect(error.message).to.contain('nothing to capture')
      done()
    })
    cy.mount('<div style="width: 0; height: 0"></div>')
    cy.screenshot('empty')
  })
})
