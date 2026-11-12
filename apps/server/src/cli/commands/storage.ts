import { storageUsage } from '@circi/db/queries'
import { migrateStorage, previewRetention, runRetention } from '@circi/services'
import type { Command } from 'commander'

import { mb } from '#cli/lib/format.ts'
import { printJson, withRuntime } from '#cli/lib/output.ts'
import { storageTarget, type StorageTargetOptions } from '#cli/lib/storage-target.ts'
import { UsageError } from '#cli/lib/usage.ts'

/** `circi admin storage usage|migrate|gc` */
export function addStorageCommands(admin: Command): void {
  const storage = admin.command('storage').description('what is stored, and cleaning up')

  storage
    .command('usage')
    .description('how much is stored, by kind, and how much is waiting to be deleted')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withRuntime(async (rt) => {
        const usage = await storageUsage(rt.db.db)
        if (opts.json) return printJson(usage)
        for (const f of usage.files)
          console.log(`${f.kind.padEnd(10)} ${String(f.count).padStart(7)} files  ${mb(f.bytes)}`)
        console.log(`${'total'.padEnd(10)} ${mb(usage.totalBytes)}`)
        console.log(
          `waiting to be deleted: ${usage.markedForDeletion.count} files, ${mb(usage.markedForDeletion.bytes)} (after the ${rt.config.gcGraceHours} h grace period)`,
        )
      }),
    )

  storage
    .command('migrate')
    .description(
      'copy every stored file to another storage (local disk or S3), under the same keys',
    )
    .requiredOption('--to <driver>', 'fs or s3')
    .option('--path <dir>', 'for fs: the target directory')
    .option('--bucket <name>', 'for s3: the target bucket')
    .option('--region <region>', 'for s3: its region')
    .option('--endpoint <url>', 'for s3: a custom endpoint (R2, MinIO…)')
    .option('--force-path-style', 'for s3: use path-style addressing (MinIO)')
    .action((opts: StorageTargetOptions) =>
      withRuntime(async (rt) => {
        const target = storageTarget(opts)
        if (!target) throw new UsageError('Use --to fs --path <dir>, or --to s3 --bucket <name>')
        await target.healthCheck()
        const result = await migrateStorage(rt.db.db, {
          from: rt.storage,
          to: target,
          onFile: (n) => {
            if (n % 100 === 0) console.log(`  ${n} files…`)
          },
        })
        console.log(
          `Copied ${result.copied}, already there ${result.skipped}, missing at the source ${result.missing.length}, failed ${result.failed.length}.`,
        )
        for (const f of result.failed.slice(0, 10)) console.log(`  failed ${f.sha256}: ${f.error}`)
        if (result.failed.length > 0) process.exitCode = 1
        else console.log(`Now set STORAGE_DRIVER=${opts.to} (and its settings) and restart.`)
      }),
    )

  storage
    .command('gc')
    .description('run retention now: expire old builds and sites, delete files nothing uses')
    .option(
      '--grace-hours <hours>',
      'how long unused files wait before deletion (default: GC_GRACE_HOURS)',
    )
    .option(
      '--dry-run',
      'list what would be deleted (count, bytes, sample of keys); change nothing',
    )
    .action((opts: { graceHours?: string; dryRun?: boolean }) =>
      withRuntime(async (rt) => {
        const grace =
          opts.graceHours === undefined ? rt.config.gcGraceHours : Number(opts.graceHours)
        if (!Number.isFinite(grace) || grace < 0)
          throw new UsageError('--grace-hours must be 0 or more')
        if (opts.dryRun) {
          const preview = await previewRetention(rt.db.db, { graceMs: grace * 3600_000 })
          const { count, bytes, sampleKeys } = preview.wouldDelete
          console.log(`Dry run: nothing is deleted or marked.`)
          console.log(
            `Would delete ${count} files, ${mb(bytes)} (unused and marked for over ${grace} h).`,
          )
          for (const key of sampleKeys) console.log(`  ${key}`)
          if (count > sampleKeys.length) console.log(`  … and ${count - sampleKeys.length} more`)
          console.log(
            `${preview.wouldMark} more unused files would be marked now and deleted after the grace period. Builds and sites past retention are not simulated.`,
          )
          return
        }
        const result = await runRetention(rt.db.db, {
          graceMs: grace * 3600_000,
          deleteObject: (key) => rt.storage.delete(key),
        })
        console.log(JSON.stringify(result, null, 2))
      }),
    )
}
