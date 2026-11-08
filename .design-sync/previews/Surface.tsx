import { COLOR_SCHEME_ATTRIBUTE, Stack, Surface, Text } from '@circi/ui'
import type { ReactNode } from 'react'

const Scheme = (props: { scheme: 'light' | 'dark'; children: ReactNode }) => (
  <div {...{ [COLOR_SCHEME_ATTRIBUTE]: props.scheme }}>
    <Surface variant="chrome" style={{ padding: 16, border: 0 }}>
      {props.children}
    </Surface>
  </div>
)

const Demo = () => (
  <Stack direction="row" gap={3}>
    {(['chrome', 'panel', 'raised', 'overlay'] as const).map((variant) => (
      <Surface key={variant} variant={variant} style={{ padding: 12, width: 120 }}>
        <Text>{variant}</Text>
      </Surface>
    ))}
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
