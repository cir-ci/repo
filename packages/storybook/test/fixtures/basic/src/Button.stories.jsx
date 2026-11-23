const Button = ({ label, color }) => (
  <button
    type="button"
    style={{ width: 160, height: 40, background: color, color: 'white', border: 0 }}
  >
    {label}
  </button>
)

export default { title: 'Components/Button', component: Button }

export const Primary = { args: { label: 'Save', color: '#2563eb' } }
export const Secondary = { args: { label: 'Cancel', color: '#475569' } }
// Not screenshotted: `parameters.circi.skip`.
export const Hidden = {
  args: { label: 'Hidden', color: '#000' },
  parameters: { circi: { skip: true } },
}
