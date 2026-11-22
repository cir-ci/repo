#!/usr/bin/env node
// Copies the app's version (apps/server/package.json, bumped by `changeset version`) into the Helm
// chart's Chart.yaml: the chart is released with the app, its `version` and `appVersion` both the
// app's, and the image tag defaults to appVersion. Runs from `pnpm version-packages`;
// packages/config/test/deploy-settings.test.ts fails when they differ.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'apps/server/package.json'), 'utf8'))
const path = join(root, 'deploy/helm/circi/Chart.yaml')
const chart = readFileSync(path, 'utf8')
  .replace(/^version: .*$/m, `version: ${version}`)
  .replace(/^appVersion: .*$/m, `appVersion: ${version}`)
writeFileSync(path, chart)
console.log(`deploy/helm/circi/Chart.yaml: ${version}`)
