import { COLOR_SCHEME_ATTRIBUTE, Link, Text, tokens } from '@circi/ui'
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
  <Text as="p">
    Read the <Link href="#docs">upload guide</Link> or go back to{' '}
    <Link href="#projects">projects</Link>. Links are underlined on hover.
  </Text>
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
