import { Avatar, Box, IconButton, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { RouterLink } from '../../components.tsx'
import { authClient, type SessionUser } from '../../lib/auth-client.ts'

/** The signed-in person, top right: who they are, and a way to sign out. */
export function UserMenu({ user }: UserMenu.Props) {
  const queryClient = useQueryClient()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  async function signOut() {
    setAnchor(null)
    await authClient.signOut()
    // Forget everything fetched as this person, so the next one never sees it.
    queryClient.clear()
  }

  return (
    <Box sx={{ ml: 'auto' }}>
      <IconButton
        aria-label={`Account menu for ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
      >
        <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem' }}>
          {user.name.slice(0, 1).toUpperCase()}
        </Avatar>
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
          <Typography sx={{ fontWeight: 600 }}>{user.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {user.email}
          </Typography>
        </Box>
        <MenuItem component={RouterLink} to="/account" onClick={() => setAnchor(null)}>
          <ListItemText>Account and sessions</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => void signOut()}>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}

export namespace UserMenu {
  export interface Props {
    user: SessionUser
  }
}
