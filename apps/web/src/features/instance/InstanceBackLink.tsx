import { SettingsBackLink } from '#features/project-settings/SettingsBackLink.tsx'

import styles from './InstanceBackLink.module.css'

/** "‹ Instance" at the top of an Instance page (Accounts, Instance settings, Health): the way up to the hub. */
export function InstanceBackLink() {
  return (
    <div className={styles.root}>
      <SettingsBackLink label="Instance" link={{ to: '/instance/overview' }} />
    </div>
  )
}
