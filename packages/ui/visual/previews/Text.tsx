import { COLOR_SCHEME_ATTRIBUTE, Stack, Text, tokens } from '@circi/ui'
import type { ReactNode } from 'react'

const Scheme = (props: { scheme: 'light' | 'dark'; children: ReactNode }) => (
  <div
    {...{ [COLOR_SCHEME_ATTRIBUTE]: props.scheme }}
    style={{ padding: 16, background: tokens.surface.panel, color: tokens.text.primary }}
  >
    {props.children}
  </div>
)

const Demo = () => (
  <Stack gap={2}>
    <Text>Body 13: Add payment form validation</Text>
    <Text variant="small" tone="secondary">
      Small 12 secondary: opened 2 minutes ago
    </Text>
    <Text variant="micro" tone="tertiary">
      Micro 11 tertiary: 4 changed
    </Text>
    <Text variant="mono">mono 12: 7fdf130 feat/checkout</Text>
    <Stack direction="row" gap={4} wrap>
      <Text tone="accent">accent</Text>
      <Text tone="approved">approved</Text>
      <Text tone="review">review</Text>
      <Text tone="processing">processing</Text>
      <Text tone="failed">failed</Text>
      <Text tone="rejected">rejected</Text>
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
