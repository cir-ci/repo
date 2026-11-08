export namespace Org {
  export interface Capabilities {
    canCreateOrganization: boolean
    manageableOrganizations: { slug: string; name: string }[]
    /** Organizations that won't show their content to the way this session signed in. */
    refusingOrganizations: { name: string; accepts: ('password' | 'email')[] }[]
  }

  export interface Auth {
    canManage: boolean
    settings: { emailLoginEnabled: boolean; passwordLoginEnabled: boolean }
    instance: { password: boolean; email: boolean }
  }

  /** An organization's own single sign-on provider. */
  export interface SsoProvider {
    providerId: string
    issuer: string
    /** What to register as the redirect address at the identity provider. */
    redirectUri: string
  }

  export interface Domain {
    id: string
    domain: string
    verified: boolean
    dnsName?: string
    dnsValue?: string
  }
}
