import { useParams } from '@tanstack/react-router'

import { GitAttentionBanner } from '#features/builds/list/GitAttentionBanner.tsx'
import { useSaveSettings } from '#features/projects/api/index.ts'
import { DeleteProjectSection } from '#features/projects/DeleteProjectSection.tsx'
import { ProjectIdentity } from '#features/projects/ProjectIdentity.tsx'

import {
  ComparisonSection,
  HostedSitesSection,
  MergeGateSection,
  RepositorySection,
} from './GeneralSections.tsx'
import { ProjectDetailsSection } from './ProjectDetailsSection.tsx'
import { ProjectSettingsFrame } from './ProjectSettingsFrame.tsx'
import { SectionFormGroup } from './SectionForm.tsx'

import styles from './ProjectSettings.module.css'

/**
 * A project's General settings. Owners and admins edit; members look. The display name and the
 * icon and color save at once; every other section waits for its own Save and Discard, which
 * appear when the section has changes and stay at the bottom of the panel while it is in view.
 */
export function ProjectSettingsPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings/general' })
  // One save per section, so one's error or pending state is never shown on another.
  const saveDetails = useSaveSettings(workspace, project)
  const saveComparison = useSaveSettings(workspace, project)
  const saveGate = useSaveSettings(workspace, project)
  const saveSites = useSaveSettings(workspace, project)
  return (
    <ProjectSettingsFrame workspace={workspace} project={project} page="General">
      {(data, name) => (
        <SectionFormGroup>
          <div className={styles.form}>
            <GitAttentionBanner attention={data.github.link?.attention} />
            <ProjectIdentity
              workspace={workspace}
              project={project}
              name={name}
              appearance={data.appearance}
              canManage={data.canManage}
            />
            {/* Each section is keyed by its own saved values: saving one never resets what is typed in another. */}
            <ProjectDetailsSection
              key={`details:${data.settings.slug}:${data.settings.defaultBranch}`}
              workspace={workspace}
              project={project}
              settings={data.settings}
              canManage={data.canManage}
              save={saveDetails}
            />
            <RepositorySection
              workspace={workspace}
              project={project}
              canManage={data.canManage}
              link={data.github.link}
            />
            <ComparisonSection
              key={`comparison:${data.settings.diffThreshold}:${data.settings.retentionDays}`}
              settings={data.settings}
              canManage={data.canManage}
              save={saveComparison}
            />
            <MergeGateSection
              key={`gate:${data.settings.blockMergeOnChanges}:${data.settings.flakyBlocksMerge}:${data.settings.autoApproveDefaultBranch}`}
              settings={data.settings}
              canManage={data.canManage}
              save={saveGate}
              workspaceFlakyBlocksMerge={data.workspace.flakyBlocksMerge}
            />
            {data.sitesConfigured ? (
              <HostedSitesSection
                key={`sites:${data.settings.staticHostingEnabled}:${data.settings.sitesFromActions}:${data.settings.sitesArtifactName}:${data.settings.sitesArtifactSiteName}`}
                settings={data.settings}
                canManage={data.canManage}
                save={saveSites}
                githubLinked={data.github.link !== null}
                lastResult={data.sitesFromActionsResult}
              />
            ) : null}
            <DeleteProjectSection
              workspace={workspace}
              project={project}
              name={name}
              canManage={data.canManage}
            />
          </div>
        </SectionFormGroup>
      )}
    </ProjectSettingsFrame>
  )
}
