import logo from './logo.svg'

import styles from './Logo.module.css'

/** The CirCI logo (the maroon tile). Decorative unless a name is given; keep the word "CirCI" beside it where a name is needed. */
export function Logo({ size = 24, alt = '', className }: Logo.Props) {
  return (
    <img
      src={logo}
      alt={alt}
      width={size}
      height={size}
      className={className ? `${styles.root} ${className}` : styles.root}
    />
  )
}

export namespace Logo {
  export interface Props {
    /** Width and height in px. */
    size?: number
    alt?: string
    className?: string
  }
}
