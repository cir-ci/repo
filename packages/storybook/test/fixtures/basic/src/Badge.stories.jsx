// A small component in a centered story: the screenshot is the badge, not the canvas around it.
const Badge = () => (
  <div style={{ width: 120, height: 40, background: '#16a34a', borderRadius: 8 }} />
)

export default { title: 'Components/Badge', component: Badge, parameters: { layout: 'centered' } }

export const Default = {}
// The shadow reaches 16 px beyond the box on every side and belongs in the screenshot.
export const Shadow = {
  render: () => (
    <div
      style={{ width: 120, height: 40, background: '#16a34a', boxShadow: '0 0 10px 6px #000' }}
    />
  ),
}
