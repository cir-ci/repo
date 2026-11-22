const Card = () => (
  <div style={{ width: 400, height: 300, background: '#e5e7eb', padding: 20 }}>
    <div id="target" style={{ width: 80, height: 60, background: '#be185d' }} />
  </div>
)

// `selector` and `padding` override the default crop: just the pink box, 5 px around it.
export default {
  title: 'Components/Card',
  component: Card,
  parameters: { circi: { selector: '#target', padding: 5 } },
}

export const Selected = {}
