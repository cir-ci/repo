import { Banner, ListRow, SectionHeader, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { workspaceQuery } from '#features/members/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/**
 * The workspace's name and address. CirCI has no way to rename a workspace yet, so these
 * are shown, not edited.
 */
export function WorkspaceGeneralPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings' })
  useDocumentTitle('General', workspace)
  const { data, error, refetch } = useQuery(workspaceQuery(workspace))

  return (
    <Frame
      crumbs={[data?.name ?? workspace, 'General']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn’t exist"
    >
      {data ? (
        <section className={styles.section}>
          <SectionHeader title="Workspace" />
          <Banner>Renaming a workspace or changing its address isn’t available yet.</Banner>
          <div className={styles.list}>
            <ListRow>
              <div className={styles.row}>
                <Text tone="secondary">Name</Text>
                <Text>{data.name}</Text>
              </div>
            </ListRow>
            <ListRow>
              <div className={styles.row}>
                <Text tone="secondary">Address</Text>
                <Text variant="mono">{data.slug}</Text>
              </div>
            </ListRow>
            <ListRow>
              <div className={styles.row}>
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
