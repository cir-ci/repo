const Throws = () => {
  throw new Error('boom from the story')
}

export default { title: 'Broken/Stories', component: Throws }

export const Throwing = { render: () => <Throws /> }
export const Empty = { render: () => null }
export const PlayThrows = {
  render: () => <div style={{ width: 50, height: 50 }} />,
  play: async () => {
    throw new Error('play failed')
  },
}
