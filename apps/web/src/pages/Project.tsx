import {
  Box,
  Breadcrumbs,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { projectQuery } from '../api.ts'
import {
  Code,
  CountsLine,
  ErrorAlert,
  Loading,
  RefLine,
  RouterLink,
  StatusChip,
  TimeAgo,
} from '../components.tsx'

export function ProjectPage() {
  const { org, project } = useParams({ from: '/$org/$project' })
  const { data, error } = useQuery(projectQuery(org, project))
  if (error) return <ErrorAlert error={error} />
  if (!data) return <Loading />

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <RouterLink to="/" underline="hover" color="inherit">
          Projects
        </RouterLink>
        <Typography color="text.secondary">{data.project.orgName}</Typography>
      </Breadcrumbs>
      <Typography variant="h1" gutterBottom>
        {data.project.name}
      </Typography>

      {data.builds.length === 0 ? (
        <Box sx={{ maxWidth: 720 }}>
          <Typography>No builds yet. Upload screenshots from CI:</Typography>
          <Code>{`CIRCI_TOKEN=… CIRCI_API_URL=${window.location.origin} npx circi upload ./screenshots --wait`}</Code>
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" aria-label="Builds">
            <TableHead>
              <TableRow>
                <TableCell>Build</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Branch</TableCell>
                <TableCell>Screenshots</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>When</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.builds.map((b) => (
                <TableRow key={b.id} hover>
                  <TableCell>
                    <RouterLink
                      to="/$org/$project/builds/$number"
                      params={{ org, project, number: String(b.number) }}
                    >
                      #{b.number}
                    </RouterLink>
                    {b.name !== 'default' ? (
                      <Chip label={b.name} variant="outlined" sx={{ ml: 1 }} />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusChip build={b} />
                  </TableCell>
                  <TableCell>
                    <RefLine build={b} />
                  </TableCell>
                  <TableCell>
                    <CountsLine counts={b.counts} />
                  </TableCell>
                  <TableCell
                    sx={{ display: { xs: 'none', md: 'table-cell' }, color: 'text.secondary' }}
                  >
                    <TimeAgo iso={b.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  )
}
