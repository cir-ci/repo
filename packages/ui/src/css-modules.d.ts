// CSS modules: `import styles from './Button.module.css'`. Vite compiles them (dev, app build and
// the library build); tsc only needs to know the shape.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

// Plain stylesheets imported for their side effect (`global.css`).
declare module '*.css' {}
