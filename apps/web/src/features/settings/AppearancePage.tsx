import { ColorSchemeControl, SectionHeader } from '@circi/ui'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/** Light, dark, or whatever the device says. Kept in this browser only. */
export function AppearancePage() {
  useDocumentTitle('Appearance')
  return (
    <Frame crumbs={['Account', 'Appearance']}>
      <section className={styles['section']}>
        <SectionHeader
          title="Theme"
          description="Applies to this browser. “System” follows your device’s light or dark setting."
        />
        <ColorSchemeControl />
      </section>
    </Frame>
  )
}
