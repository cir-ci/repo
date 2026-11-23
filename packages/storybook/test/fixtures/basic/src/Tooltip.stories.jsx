import { createPortal } from 'react-dom'

// The tooltip is rendered into document.body, outside Storybook's root.
const WithTooltip = () => (
  <>
    <div style={{ width: 100, height: 30, background: '#0ea5e9' }} />
    {createPortal(
      <div
        style={{
          position: 'absolute',
          top: 150,
          left: 300,
          width: 200,
          height: 50,
          background: '#dc2626',
        }}
      />,
      document.body,
    )}
  </>
)

export default { title: 'Components/Tooltip', component: WithTooltip }

export const Open = {}
