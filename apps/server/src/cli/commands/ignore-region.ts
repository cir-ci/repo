import { listIgnoreRegions } from '@circi/db/queries'
import { createIgnoreRegion, deleteIgnoreRegion } from '@circi/services'
import type { Command } from 'commander'

import { withRuntime } from '#cli/lib/output.ts'
import { teamOf } from '#cli/lib/team.ts'

/** `circi admin ignore add|list|remove` */
export function addIgnoreCommands(admin: Command): void {
  const ignore = admin.command('ignore').description('regions to ignore when comparing screenshots')

  ignore
    .command('add')
    .description('ignore a rectangle (pixels from the top left) in the screenshots with this name')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .requiredOption('--name <name>', 'the screenshot name, as shown in the build')
    .requiredOption('--region <x,y,width,height>', 'the rectangle')
    .action((opts: { org: string; team: string; name: string; region: string }) =>
      withRuntime(async (rt) => {
        const [x, y, width, height] = opts.region.split(',').map((n) => Number(n.trim()))
        if ([x, y, width, height].some((n) => n === undefined || Number.isNaN(n))) {
          throw new Error('--region must look like 10,20,300,40')
        }
        const team = await teamOf(rt, opts.org, opts.team)
        const added = await createIgnoreRegion(rt.db.db, {
          teamId: team.id,
          name: opts.name,
          x: x ?? 0,
          y: y ?? 0,
          width: width ?? 0,
          height: height ?? 0,
        })
        console.log(
          `Added ${added.id}: ${added.name} ${added.x},${added.y} ${added.width}x${added.height}`,
        )
        console.log('It applies to builds processed from now on (use /circi rerun to redo one).')
      }),
    )

  ignore
    .command('list')
    .description("list a team's ignored regions")
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .action((opts: { org: string; team: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        for (const r of await listIgnoreRegions(rt.db.db, team.id)) {
          console.log(`${r.id}  ${r.name}  ${r.x},${r.y} ${r.width}x${r.height}`)
        }
      }),
    )

  ignore
    .command('remove <id>')
    .description('stop ignoring a region')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .action((id: string, opts: { org: string; team: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        await deleteIgnoreRegion(rt.db.db, team.id, id)
        console.log('Removed.')
      }),
    )
}
