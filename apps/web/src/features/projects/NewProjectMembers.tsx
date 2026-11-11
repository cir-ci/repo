import {
  Avatar,
  Checkbox,
  CloseIcon,
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
  IconButton,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'
import { authClient } from '#lib/auth-client.ts'

import styles from './NewProjectMembers.module.css'

/**
 * The New project dialog's Members field (the canvas's NewProject board): you, fixed because the
 * person who creates a project is in it, then the people picked from the workspace, each removable,
 * and "Add members" opening a short list to pick from. Optional: nobody else is needed.
 */
export function NewProjectMembers({ workspace, value, onChange }: NewProjectMembers.Props) {
  const { data: session } = authClient.useSession()
  const me = session?.user
  const query = useQuery(workspaceQuery(workspace))
  const [search, setSearch] = useState('')
  const everyone = (query.data?.members ?? []).filter((m) => m.userId !== me?.id)
  const picked = value.flatMap((id) => everyone.filter((m) => m.userId === id))
  const needle = search.trim().toLowerCase()
  const choices = everyone.filter(
    (m) =>
      !value.includes(m.userId) &&
      (!needle ||
        m.user.name.toLowerCase().includes(needle) ||
        m.user.email.toLowerCase().includes(needle)),
  )

  return (
    <CollapsibleRoot className={styles.root}>
      <span className={styles.label} id="new-project-members">
        Members{' '}
        <Text as="span" tone="tertiary">
          · optional
        </Text>
      </span>
      <div role="group" aria-labelledby="new-project-members" className={styles.chips}>
        {me ? (
          <span className={styles.chip}>
            <Avatar
              type="user"
              aria-hidden
              id={me.id}
              name={me.name}
              image={me.image ?? null}
              size={20}
            />
            {me.name}{' '}
            <Text as="span" tone="tertiary">
              · you
            </Text>
          </span>
        ) : null}
        {picked.map((m) => (
          <span key={m.userId} className={styles.chip}>
            <Avatar
              type="user"
              aria-hidden
              id={m.userId}
              name={m.user.name}
              image={m.user.image ?? null}
              size={20}
            />
            {m.user.name}
            <IconButton
              label={`Remove ${m.user.name}`}
              onClick={() => onChange(value.filter((id) => id !== m.userId))}
            >
              <CloseIcon size={12} />
            </IconButton>
          </span>
        ))}
        <CollapsibleTrigger size="sm">Add members</CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <div className={styles.picker}>
          <TextField
            label="Find a workspace member"
            hideLabel
            placeholder="Find a workspace member"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {choices.length === 0 ? (
            <Text variant="small" tone="tertiary">
              {needle ? `No workspace member matches “${search.trim()}”.` : 'No one else to add.'}
            </Text>
          ) : (
            <ul aria-label="Workspace members" className={styles.choices}>
              {choices.map((m) => (
                <li key={m.userId}>
                  <Checkbox
                    className={styles.choice}
                    checked={false}
                    onCheckedChange={() => onChange([...value, m.userId])}
                    label={
                      <>
                        <Avatar
                          type="user"
                          aria-hidden
                          id={m.userId}
                          name={m.user.name}
                          image={m.user.image ?? null}
                          size={20}
                        />
                        {m.user.name}
                        <Text as="span" variant="small" tone="tertiary">
                          {m.user.email}
                        </Text>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}

export namespace NewProjectMembers {
  export interface Props {
    /** The workspace the project is created in. */
    workspace: string
    /** The IDs picked besides you. */
    value: string[]
    onChange: (value: string[]) => void
  }
}
