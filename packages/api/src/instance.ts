export namespace Instance {
  export interface AuthMethods {
    password: boolean
    email: boolean
    sso: { id: string; name: string }[]
  }

  export interface Notices {
    publicUrlChange: { from: string; to: string; at: string; checklist: string[] } | null
  }
}
