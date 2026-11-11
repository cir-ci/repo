import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic.mjs'

const isIconName = (name: string): name is IconName => iconNames.some((n) => n === name)

/**
 * A project's Lucide icon. This file is the only one that imports `lucide-react/dynamic`, whose map
 * of every icon is large, so `Avatar` loads it on demand (`lazy`) and the dashboard's first
 * script carries none of it; each icon then loads as its own small file when it is first drawn.
 */
export default function ProjectGlyph({ name, size }: { name: string; size: number }) {
  if (!isIconName(name)) return null
  return <DynamicIcon name={name} size={size} strokeWidth={1.75} aria-hidden="true" />
}
