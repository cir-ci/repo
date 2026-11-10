/** The team tile palette: `--circi-team-<colour>`. */
export const TEAM_COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const

export type TeamColor = (typeof TEAM_COLORS)[number]
