import { type Project } from '@circi/api'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type FormEvent } from 'react'

import { useAnnounce } from '../../primitives/feedback.tsx'
import { useSaveSettings } from './api.ts'

export function SettingsForm(props: SettingsForm.Props) {
  const save = useSaveSettings(props.org, props.project)
  const announce = useAnnounce()
  const [saved, setSaved] = useState(false)
  const s = props.settings

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (key: string) => {
      const v = form.get(key)
      return typeof v === 'string' ? v : ''
    }
    setSaved(false)
    await save.mutateAsync({
      name: text('name'),
      defaultBranch: text('defaultBranch'),
      diffThreshold: Number(text('diffThresholdPercent')) / 100,
      retentionDays: Number(text('retentionDays')),
      autoApproveDefaultBranch: form.has('autoApproveDefaultBranch'),
      blockMergeOnChanges: form.has('blockMergeOnChanges'),
    })
    setSaved(true)
    announce('Settings saved')
  }

  return (
    <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        Builds
      </Typography>
      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        <TextField
          name="name"
          label="Name"
          defaultValue={s.name}
          size="small"
          disabled={!props.canManage}
        />
        <TextField
          name="defaultBranch"
          label="Default branch"
          defaultValue={s.defaultBranch}
          size="small"
          disabled={!props.canManage}
          helperText="Builds on this branch become the baselines that pull requests are compared with."
        />
        <TextField
          name="diffThresholdPercent"
          label="Ignore differences below (% of pixels)"
          type="number"
          defaultValue={Number((s.diffThreshold * 100).toFixed(4))}
          size="small"
          disabled={!props.canManage}
          slotProps={{ htmlInput: { min: 0, max: 100, step: 'any' } }}
          helperText="0 reports every changed pixel."
        />
        <TextField
          name="retentionDays"
          label="Keep builds for (days)"
          type="number"
          defaultValue={s.retentionDays}
          size="small"
          disabled={!props.canManage}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
        />
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                name="blockMergeOnChanges"
                defaultChecked={s.blockMergeOnChanges}
                disabled={!props.canManage}
              />
            }
            label="Block merging until changes are approved"
          />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mt: -0.5, mb: 1 }}>
            With this off, `circi upload --wait` passes even when visual changes need review.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                name="autoApproveDefaultBranch"
                defaultChecked={s.autoApproveDefaultBranch}
                disabled={!props.canManage}
              />
            }
            label="Approve builds on the default branch automatically"
          />
        </FormGroup>
        {save.error ? <Alert severity="error">{save.error.message}</Alert> : null}
        {saved ? <Alert severity="success">Settings saved.</Alert> : null}
        {props.canManage ? (
          <Box>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </Box>
        ) : null}
      </Stack>
    </Box>
  )
}

export namespace SettingsForm {
  export interface Props {
    org: string
    project: string
    settings: Project.Settings
    canManage: boolean
  }
}
