/** Whether the person runs the instance: better-auth's `admin` role (a role list is comma separated). */
export const isInstanceAdmin = (user: { role?: string | undefined } | undefined): boolean =>
  (user?.role ?? '').split(',').includes('admin')
