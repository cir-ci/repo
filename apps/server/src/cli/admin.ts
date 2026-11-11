import type { Command } from 'commander'

import { addAuthCommands } from '#cli/commands/auth.ts'
import { addDoctorCommand } from '#cli/commands/doctor.ts'
import { addGithubCommands } from '#cli/commands/github.ts'
import { addIgnoreCommands } from '#cli/commands/ignore-region.ts'
import { addMailCommands } from '#cli/commands/mail.ts'
import { addProjectCommands } from '#cli/commands/project.ts'
import { addSetupCodeCommand } from '#cli/commands/setup-code.ts'
import { addStorageCommands } from '#cli/commands/storage.ts'
import { addUserCommands } from '#cli/commands/user.ts'
import { addWebhookCommands } from '#cli/commands/webhook.ts'
import { addMemberCommands, addWorkspaceCommands } from '#cli/commands/workspace.ts'

/** `circi admin …`, run on the server: one file per command group in `commands/`. */
export function addAdminCommands(program: Command): void {
  const admin = program.command('admin').description('administration commands (run on the server)')
  addUserCommands(admin)
  addWorkspaceCommands(admin)
  addMemberCommands(admin)
  addProjectCommands(admin)
  addMailCommands(admin)
  addGithubCommands(admin)
  addDoctorCommand(admin)
  addIgnoreCommands(admin)
  addStorageCommands(admin)
  addAuthCommands(admin)
  addSetupCodeCommand(admin)
  addWebhookCommands(admin)
}
