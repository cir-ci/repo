/**
 * The service layer: operations that change several things at once. A service opens the
 * transaction, calls repositories from `@circi/db` for the data, and queues the jobs and notices
 * that follow. Apps (server, worker) call services for anything that changes a build's state.
 */
export {
  completeBuild,
  describeStall,
  expireStalledBuilds,
  failBuild,
  finalizeBuild,
  requeueBuild,
} from './builds.ts'
export { reviewBuild } from './reviews.ts'
