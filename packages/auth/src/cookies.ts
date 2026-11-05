const hostCookie = (name: string) => ({
  name: `__Host-circi.${name}`,
  attributes: { secure: true, path: '/' },
})

/**
 * Over https, dashboard cookies get the `__Host-` prefix (PLAN §7.6): browsers then only accept
 * them if they're Secure, have no Domain and Path=/, so a hosted site on a subdomain can't set
 * or overwrite them. better-auth's own `useSecureCookies` would give the weaker `__Secure-`
 * prefix, so it's off and the names and attributes are set here. Over plain http (local
 * development) `__Host-` cookies can't work, so better-auth's defaults apply.
 */
export function hostCookies(baseURL: string) {
  if (!baseURL.startsWith('https://')) return { useSecureCookies: false }
  return {
    useSecureCookies: false,
    cookies: {
      session_token: hostCookie('session_token'),
      session_data: hostCookie('session_data'),
      account_data: hostCookie('account_data'),
      dont_remember: hostCookie('dont_remember'),
    },
  }
}
