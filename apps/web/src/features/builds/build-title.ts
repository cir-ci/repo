/** A build's heading: `Build #148`, with its name after it unless it is the usual "default" one. */
export const buildTitle = (number: number, name?: string): string =>
  name && name !== 'default' ? `Build #${number} · ${name}` : `Build #${number}`
