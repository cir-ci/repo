import { circiTokensCss } from '@circi/ui/tokens-css'
import web from '@circi/vitest-config/vitest.web.config.ts'

// Fills the token variables into @circi/ui's global.css, as the real build does.
export default web(import.meta.dirname, { plugins: [circiTokensCss()] })
