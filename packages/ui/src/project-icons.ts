/** The project tile palette: `--circi-project-<colour>`. */
export const PROJECT_COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const

export type ProjectColor = (typeof PROJECT_COLORS)[number]
