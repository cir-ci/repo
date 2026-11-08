import { Banner, ListRow, SectionHeader, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { organizationQuery } from '../members/api.ts'
import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/**
 * The organisation's name and address. CirCI has no way to rename an organisation yet, so these
 * are shown, not edited.
 */
export function OrgGeneralPage() {
  const { org } = useParams({ from: '/organizations/$org/settings' })
  useDocumentTitle('General', org)
  const { data, error, refetch } = useQuery(organizationQuery(org))

  return (
    <Frame
      crumbs={[data?.name ?? org, 'General']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
    >
      {data ? (
        <section className={styles['section']}>
          <SectionHeader title="Organisation" />
          <Banner>Renaming an organisation or changing its address isn’t available yet.</Banner>
          <div className={styles['list']}>
            <ListRow>
              <div className={styles['row']}>
                <Text tone="secondary">Name</Text>
                <Text>{data.name}</Text>
              </div>
            </ListRow>
            <ListRow>
              <div className={styles['row']}>
                <Text tone="secondary">Address</Text>
                <Text variant="mono">{data.slug}</Text>
              </div>
            </ListRow>
            <ListRow>
              <div className={styles['row']}>
                <Text tone="secondary">People</Text>
                <Text>{data.members.length}</Text>
              </div>
            </ListRow>
          </div>
        </section>
      ) : null}
    </Frame>
  )
}
