import {
  createSavedView,
  type Database,
  deleteSavedView,
  pinProject as pinRow,
  reorderSavedViews,
  type SavedViewRow,
  unpinProject as unpinRow,
  updateSavedView,
} from '@circi/db'

/**
 * A person's sidebar: saved views and pinned projects. Nothing here notifies anyone, so these
 * are thin: each runs in its own transaction and only ever touches the owner's rows. Whether
 * the owner belongs to the organization (and the project to it) is the caller's check.
 */

export async function createView(
  db: Database,
  input: createSavedView.Input,
): Promise<SavedViewRow> {
  return db.transaction((tx) => createSavedView(tx, input))
}

export async function renameView(
  db: Database,
  input: { userId: string; orgId: string; id: string; name: string },
): Promise<SavedViewRow> {
  return db.transaction((tx) => updateSavedView(tx, input))
}

export async function updateViewFilters(
  db: Database,
  input: { userId: string; orgId: string; id: string; filters: updateSavedView.Input['filters'] },
): Promise<SavedViewRow> {
  return db.transaction((tx) => updateSavedView(tx, input))
}

export async function setViewPinned(
  db: Database,
  input: { userId: string; orgId: string; id: string; pinned: boolean },
): Promise<SavedViewRow> {
  return db.transaction((tx) => updateSavedView(tx, input))
}

/** Changes any of name, filters and pinned in one go (the PATCH route). */
export async function updateView(
  db: Database,
  input: updateSavedView.Input,
): Promise<SavedViewRow> {
  return db.transaction((tx) => updateSavedView(tx, input))
}

export async function reorderViews(
  db: Database,
  input: { userId: string; orgId: string; ids: string[] },
): Promise<SavedViewRow[]> {
  return db.transaction((tx) => reorderSavedViews(tx, input))
}

export async function deleteView(
  db: Database,
  input: { userId: string; orgId: string; id: string },
): Promise<void> {
  await db.transaction((tx) => deleteSavedView(tx, input))
}

export async function pinProject(
  db: Database,
  input: { userId: string; projectId: string },
): Promise<boolean> {
  return db.transaction((tx) => pinRow(tx, input))
}

export async function unpinProject(
  db: Database,
  input: { userId: string; projectId: string },
): Promise<boolean> {
  return db.transaction((tx) => unpinRow(tx, input))
}
