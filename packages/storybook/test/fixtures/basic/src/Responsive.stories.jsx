const Box = () => <div style={{ width: '100%', height: 30, background: '#0d9488' }} />

export default {
  title: 'Components/Responsive',
  component: Box,
  parameters: { layout: 'fullscreen' },
}

export const Default = {}
// The story's own viewport (Storybook's Viewport addon parameters) is the screenshot's viewport.
export const Phone = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '360px', height: '640px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}
export const Tablet = { parameters: { viewport: { defaultViewport: 'tablet' } } }
// parameters.circi.viewports wins over everything.
export const Two = { parameters: { circi: { viewports: ['small=400x300', '500x300'] } } }
