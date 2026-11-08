import { COLOR_SCHEME_ATTRIBUTE, Heading, Stack, Text, tokens } from '@circi/ui'
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
  <Stack gap={3}>
    <Heading level="display">Set up CirCI</Heading>
    <Heading level="title">Create a team</Heading>
    <Heading>Webhooks</Heading>
    <Text variant="small" tone="secondary">
      Display 20, title 15, heading 13.
    </Text>
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
