import { COLOR_SCHEME_ATTRIBUTE, Stack, Surface, Text, tokens } from '@circi/ui'
import type { ReactNode } from 'react'

const Scheme = (props: { scheme: 'light' | 'dark'; children: ReactNode }) => (
  <div
    {...{ [COLOR_SCHEME_ATTRIBUTE]: props.scheme }}
    style={{ padding: 16, background: tokens.surface.chrome, color: tokens.text.primary }}
  >
    {props.children}
  </div>
)

const Demo = () => (
  <Stack gap={4}>
    <Stack direction="row" gap={2} align="center">
      <Surface variant="raised" style={{ padding: '4px 10px' }}>
        <Text>Row</Text>
      </Surface>
      <Surface variant="raised" style={{ padding: '4px 10px' }}>
        <Text>with gap 2</Text>
      </Surface>
    </Stack>
    <Stack direction="row" justify="between" align="center">
      <Text>Left</Text>
      <Text tone="secondary">Right</Text>
    </Stack>
    <Stack gap={1}>
      <Text>Column, gap 1</Text>
      <Text tone="secondary">Second line</Text>
    </Stack>
  </Stack>
)

export const Dark = () => (
  <Scheme scheme="dark">
    <Demo />
  </Scheme>
)

export const Light = () => (
  <Scheme scheme="light">
    <Demo />
  </Scheme>
)
