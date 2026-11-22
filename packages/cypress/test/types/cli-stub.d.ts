// A stand-in for @circi/cli in this package's browser-typed program (its sources don't compile
// with the DOM library); the real types are checked by the root typecheck.
export declare namespace upload {
  interface Options {
    dir: string
    [key: string]: unknown
  }
  interface Result {
    exitCode: 0 | 1 | 2
  }
}
export declare function upload(options: upload.Options): Promise<upload.Result>
export declare function errorLine(err: unknown): string
export declare function parseShard(text: string): { index: number; total: number } | undefined
