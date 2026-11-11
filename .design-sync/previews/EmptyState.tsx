import {
  COLOR_SCHEME_ATTRIBUTE,
  tokens,
  Button,
  CommandBlock,
  EmptyState,
  ImagesIcon,
  NoFilterResults,
  NoResults,
  PanePlaceholder,
  BellIcon,
  LayersIcon,
} from '@circi/ui'
import type { ReactNode } from 'react'

/** The same content in both schemes: any subtree can be pinned with the attribute. */
const Both = (props: { children: ReactNode; width?: number }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {(['dark', 'light'] as const).map((scheme) => (
      <div
        key={scheme}
        {...{ [COLOR_SCHEME_ATTRIBUTE]: scheme }}
        style={{
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: tokens.surface.panel,
          color: tokens.text.primary,
          fontSize: 13,
          width: props.width,
        }}
      >
        {props.children}
      </div>
    ))}
  </div>
)

export const Empty = () => (
  <Both width={480}>
    <EmptyState
      icon={<LayersIcon />}
      size="section"
      title="No projects yet"
      action={<Button variant="primary">New project</Button>}
    >
      Create a project to start uploading screenshots.
    </EmptyState>
  </Both>
)

export const Success = () => (
  <Both width={480}>
    <EmptyState tone="success" size="section" title="You're all caught up">
      Reviews, mentions and decisions for you appear here.
    </EmptyState>
  </Both>
)

export const FirstRunCommand = () => (
  <Both width={480}>
    <EmptyState
      icon={<ImagesIcon />}
      size="section"
      title="No builds yet"
      action={
        <CommandBlock
          command={
            'CIRCI_TOKEN=… CIRCI_API_URL=https://ci.example.com \\\n  npx circi upload ./screenshots --wait'
          }
        />
      }
    >
      Builds appear here once your CI uploads screenshots.
    </EmptyState>
  </Both>
)

export const NoResultsSearch = () => (
  <Both width={480}>
    <NoResults size="section" noun="project" query="checkout" onClear={() => {}} />
  </Both>
)

export const NoResultsFilters = () => (
  <Both width={480}>
    <NoFilterResults size="section" plural="builds" scope="web-app" onClear={() => {}} />
  </Both>
)

export const Pane = () => (
  <Both width={340}>
    <PanePlaceholder icon={<BellIcon />}>Select a notification</PanePlaceholder>
  </Both>
)

export const Error = () => (
  <Both width={480}>
    <EmptyState
      title="This build doesn’t exist"
      tone="failed"
      size="section"
      action={<Button>Back to Projects</Button>}
    >
      It may have expired, or the link is wrong.
    </EmptyState>
  </Both>
)
