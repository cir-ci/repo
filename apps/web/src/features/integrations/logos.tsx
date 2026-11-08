import type { Integration } from '@circi/api'

/**
 * A provider's mark: a small rounded square with its monogram (simple, ours, not the vendors'
 * artwork). Decorative: the name is always written next to it. Add a provider here when its kind
 * is added to the catalog (`@circi/core`); unknown kinds get a plain letter.
 */
const MARKS: Record<string, { text: string; fill: string }> = {
  github: { text: 'GH', fill: '#24292f' },
  gitlab: { text: 'GL', fill: '#c2410c' },
  bitbucket: { text: 'BB', fill: '#1d4ed8' },
  'azure-devops': { text: 'AZ', fill: '#2563eb' },
  slack: { text: 'Sl', fill: '#7c3aed' },
  teams: { text: 'Tm', fill: '#4f46e5' },
  figma: { text: 'Fg', fill: '#be185d' },
  penpot: { text: 'Pp', fill: '#0f766e' },
  linear: { text: 'Ln', fill: '#4338ca' },
  jira: { text: 'Ji', fill: '#1e40af' },
}

export function ProviderLogo({ kind, size = 28 }: ProviderLogo.Props) {
  const mark = MARKS[kind] ?? { text: kind.slice(0, 1).toUpperCase(), fill: '#52525b' }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
      data-kind={kind}
    >
      <rect width="28" height="28" rx="6" fill={mark.fill} />
      <text
        x="14"
        y="18.5"
        textAnchor="middle"
        fontSize="12"
        fontWeight="600"
        fontFamily="Inter Variable, system-ui, sans-serif"
        fill="#ffffff"
      >
        {mark.text}
      </text>
    </svg>
  )
}

export namespace ProviderLogo {
  export interface Props {
    kind: Integration.Item['kind']
    size?: number
  }
}
