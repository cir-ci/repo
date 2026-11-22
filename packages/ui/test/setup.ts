import { guardConsole } from './support/console-guard.ts'

// A test fails on a console.error it didn't expect or a promise rejected without a handler.
guardConsole()
