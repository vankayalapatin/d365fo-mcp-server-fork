/**
 * Rollback of a file that d365fo_file(action="create") recorded creating in
 * THIS server session — the non-git undo primitive.
 *
 * Extracted verbatim from undoLastModification.ts's private `undoViaLedger`
 * (+ its `removeFromProjectSafe` / `cleanupIndexAfterUndo` helpers) so it has
 * two callers instead of one:
 *   - undo_last_modification, for a single file (unchanged behaviour — it wraps
 *     these outcomes back into its original MCP-shaped messages)
 *   - the multi-artifact create path (data entity set), which rolls back the
 *     artifacts it already wrote when a later one fails
 *
 * Safe by construction, exactly as before: it acts ONLY on a path present in
 * the session ledger (src/tools/createdArtifactLedger.ts), and the create path
 * records a path only when the file did not already exist. It can therefore
 * never delete a pre-existing or unrelated file, nor one the tool merely
 * overwrote.
 *
 * Why a structured outcome rather than MCP content: the orchestrator needs to
 * know WHICH of these four things happened per artifact to report accurately,
 * and parsing prose to find out would be absurd. undo_last_modification maps
 * these back to its original strings, so its user-facing messages are
 * unchanged (pinned by tests/tools/undo-ledger*.test.ts).
 */

import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import type { XppServerContext } from '../types/context.js';
import { bridgeRefreshProvider } from '../bridge/index.js';
import { lookupCreatedArtifact, forgetCreatedArtifact, type CreatedArtifact } from './createdArtifactLedger.js';

export type RollbackCreatedArtifactOutcome =
  /** Not in this session's ledger — nothing was touched. */
  | { status: 'not-recorded' }
  /** Recorded but already gone from disk; project + index entries were still cleaned. */
  | { status: 'already-absent'; entry: CreatedArtifact }
  /** Recorded but the path is not a regular file — refused, nothing cleaned. */
  | { status: 'refused-not-a-file'; entry: CreatedArtifact }
  /** File deleted, project entry removed, ledger entry forgotten, index cleaned. */
  | { status: 'rolled-back'; entry: CreatedArtifact };

/**
 * Roll back one session-created file. Returns `{ status: 'not-recorded' }`
 * when `absolutePath` is not in the ledger, so callers can fall back to their
 * own handling rather than treating it as a failure.
 */
export async function rollbackCreatedArtifact(
  absolutePath: string,
  context: XppServerContext,
): Promise<RollbackCreatedArtifactOutcome> {
  const entry = lookupCreatedArtifact(absolutePath);
  if (!entry) return { status: 'not-recorded' };

  if (!fs.existsSync(absolutePath)) {
    // Already gone (e.g. removed by hand). Still clean the project + index and
    // forget the ledger entry so the run's state is consistent.
    await removeFromProjectSafe(entry);
    forgetCreatedArtifact(absolutePath);
    await cleanupIndexAfterUndo(context, absolutePath, 'deleted');
    return { status: 'already-absent', entry };
  }

  const stat = await fsp.stat(absolutePath);
  if (!stat.isFile()) {
    return { status: 'refused-not-a-file', entry };
  }

  fs.unlinkSync(absolutePath);
  await removeFromProjectSafe(entry);
  forgetCreatedArtifact(absolutePath);
  await cleanupIndexAfterUndo(context, absolutePath, 'deleted');

  return { status: 'rolled-back', entry };
}

/**
 * Best-effort reversal of create_d365fo_file's addToProject. Non-fatal: a failure
 * to touch the .rnrproj must never abort the file deletion that already succeeded.
 * Uses a dynamic import to avoid a static dependency cycle with createD365File.ts.
 */
async function removeFromProjectSafe(entry: CreatedArtifact): Promise<void> {
  if (!entry.projectPath || !entry.objectType || !entry.objectName) return;
  try {
    const { ProjectFileManager } = await import('./createD365File.js');
    await new ProjectFileManager().removeFromProject(entry.projectPath, entry.objectType, entry.objectName);
  } catch (e) {
    console.error(`[undo] Non-git project cleanup failed (non-fatal): ${e}`);
  }
}

/**
 * Clean up the symbol index, label index, and bridge after a file is reverted or
 * deleted by undo_last_modification. Deleted files: remove stale symbols + labels.
 * Reverted files: re-index from the restored content.
 *
 * Exported because undo_last_modification's GIT branch calls it too (for the
 * 'reverted' case, which has no ledger involvement). Duplicating it there
 * instead would be strictly worse — this is a move, not a fork.
 */
export async function cleanupIndexAfterUndo(
  context: XppServerContext,
  filePath: string,
  action: 'deleted' | 'reverted',
): Promise<void> {
  const { symbolIndex } = context;

  try {
    const { deletedCount } = symbolIndex?.removeSymbolsByFile?.(filePath) ?? { deletedCount: 0 };
    console.error(`[undo] Removed ${deletedCount} stale symbol(s) for ${path.basename(filePath)}`);

    const labelCount = symbolIndex?.removeLabelsByFile?.(filePath) ?? 0;
    if (labelCount > 0) {
      console.error(`[undo] Removed ${labelCount} stale label(s) for ${path.basename(filePath)}`);
    }

    try {
      await bridgeRefreshProvider(context.bridge);
    } catch { /* bridge not available */ }

    if (action === 'reverted' && fs.existsSync(filePath)) {
      // Dynamic import to avoid a circular dependency
      const { updateSymbolIndexTool } = await import('./updateSymbolIndex.js');
      await updateSymbolIndexTool({ filePath }, context);
      console.error(`[undo] Re-indexed reverted file: ${path.basename(filePath)}`);
    }
  } catch (e) {
    console.error(`[undo] Index cleanup failed (non-fatal): ${e}`);
  }
}
