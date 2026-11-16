import { Avatar, COLOR_SCHEME_ATTRIBUTE, tokens } from '@circi/ui'
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

const row = { display: 'flex', alignItems: 'center', gap: 12 } as const

const PICTURE =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'%3E%3Crect width='4' height='4' fill='gray'/%3E%3C/svg%3E"

const COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const

export const UserSizes = () => (
  <Both>
    <div style={row}>
      <Avatar type="user" id="user-1" name="Ada Lovelace" image={null} />
      <Avatar type="user" id="user-2" name="Grace Hopper" image={null} size={32} />
      <Avatar type="user" id="user-3" name="Edsger Dijkstra" image={null} size={40} />
    </div>
  </Both>
)

export const UserFaces = () => (
  <Both>
    <div style={row}>
      {['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6', 'user-7', 'user-8'].map(
        (id) => (
          <Avatar key={id} type="user" id={id} name={id} image={null} size={32} />
        ),
      )}
    </div>
  </Both>
)

export const UserPicture = () => (
  <Both>
    <Avatar type="user" id="user-1" name="Ada Lovelace" image={PICTURE} size={40} />
  </Both>
)

export const Projectsizes = () => (
  <Both>
    <div style={row}>
      <Avatar type="project" slug="web-app" name="Web app" color="slate" icon={null} size={16} />
      <Avatar
        type="project"
        slug="storefront"
        name="Storefront"
        color="plum"
        icon={null}
        size={20}
      />
      <Avatar type="project" slug="mobile" name="Mobile" color="olive" icon={null} size={24} />
      <Avatar
        type="project"
        slug="design-system"
        name="Design system"
        color="moss"
        icon={null}
        size={40}
      />
    </div>
  </Both>
)

export const ProjectIcons = () => (
  <Both>
    <div style={row}>
      <Avatar type="project" slug="web-app" name="Web app" color="slate" icon="globe" size={16} />
      <Avatar
        type="project"
        slug="storefront"
        name="Storefront"
        color="plum"
        icon="shopping-cart"
        size={20}
      />
      <Avatar
        type="project"
        slug="mobile"
        name="Mobile"
        color="olive"
        icon="smartphone"
        size={24}
      />
      <Avatar
        type="project"
        slug="design-system"
        name="Design system"
        color="moss"
        icon="component"
        size={40}
      />
    </div>
  </Both>
)

export const ProjectColors = () => (
  <Both>
    <div style={row}>
      {COLORS.map((color) => (
        <Avatar
          key={color}
          type="project"
          slug="web"
          name={color}
          color={color}
          icon={null}
          size={24}
        />
      ))}
    </div>
  </Both>
)

export const ProjectMarbles = () => (
  <Both>
    <div style={row}>
      {['web', 'storefront', 'mobile', 'design-system', 'docs', 'api'].map((slug) => (
        <Avatar
          key={slug}
          type="project"
          slug={slug}
          name={slug}
          color="mauve"
          icon={null}
          size={40}
        />
      ))}
    </div>
  </Both>
)

export const WorkspaceSizes = () => (
  <Both>
    <div style={row}>
      <Avatar type="workspace" slug="acme" name="Acme" picture={null} size={16} />
      <Avatar type="workspace" slug="acme" name="Acme" picture={null} size={20} />
      <Avatar type="workspace" slug="acme" name="Acme" picture={null} size={24} />
    </div>
  </Both>
)

export const WorkspacePatterns = () => (
  <Both>
    <div style={row}>
      {['acme', 'side-project', 'northwind', 'initech', 'globex', 'umbrella'].map((slug) => (
        <Avatar key={slug} type="workspace" slug={slug} name={slug} picture={null} size={24} />
      ))}
    </div>
  </Both>
)

export const WorkspacePicture = () => (
  <Both>
    <Avatar type="workspace" slug="acme" name="Acme" picture={PICTURE} size={24} />
  </Both>
)
