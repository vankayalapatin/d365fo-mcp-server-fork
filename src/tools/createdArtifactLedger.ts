/**
 * Session-scoped ledger of files that d365fo_file(action="create") wrote to disk
 * for the FIRST time in this MCP server process.
 *
 * Why this exists: undo_last_modification is git-based. It reverts tracked files
 * with `git checkout` and deletes git-untracked files after proving they are
 * untracked. But the D365FO sandbox (K:\AosService\PackagesLocalDirectory) is NOT
 * a git repository, so `git rev-parse --show-toplevel` fails and undo cannot roll
 * back anything there — the exact per-run rollback the eval loop mandates.
 *
 * This ledger is undo's authoritative, safe answer for the non-git case: undo may
 * delete a file ONLY when the create tool recorded creating it here this session.
 * It is deliberately in-memory (a module singleton shared by every tool in the
 * process) and records ONLY genuinely-new files (the create path gates recording
 * on "the file did not already exist on disk"), so undo can never delete a file
 * the tool merely overwrote or a pre-existing/unrelated file.
 *
 * Corpus evidence: eval/corpus/runs/2026-07-21T__L3-custom-service-basic__a2a4131.json
 * (finding A — undo returns "File is not inside a git repository" for every sandbox
 * write).
 */

export interface CreatedArtifact {
  /** Absolute path of the created XML file, as written to disk. */
  filePath: string;
  /** AOT object type (e.g. "class", "service") — used to clean the .rnrproj. */
  objectType?: string;
  /** Resolved AOT object name — used to locate the .rnrproj <Content Include>. */
  objectName?: string;
  /** Absolute path of the .rnrproj the file was added to, when known. */
  projectPath?: string;
}

/**
 * Normalize a path to a case-insensitive, separator-agnostic key.
 *
 * We deliberately do NOT use path.resolve(): the created paths are already
 * absolute Windows paths, and resolve() would prepend a drive letter to
 * POSIX-style inputs when the server runs off-Windows (same reasoning as
 * undoLastModification's own path handling).
 */
export function ledgerKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const ledger = new Map<string, CreatedArtifact>();

/** Record a genuinely-new file the create tool just wrote. */
export function recordCreatedArtifact(entry: CreatedArtifact): void {
  if (!entry.filePath) return;
  ledger.set(ledgerKey(entry.filePath), { ...entry });
}

/** Look up whether THIS session created `filePath`; undefined if not recorded. */
export function lookupCreatedArtifact(filePath: string): CreatedArtifact | undefined {
  if (!filePath) return undefined;
  return ledger.get(ledgerKey(filePath));
}

/** Drop a ledger entry once it has been undone (or is no longer relevant). */
export function forgetCreatedArtifact(filePath: string): void {
  if (!filePath) return;
  ledger.delete(ledgerKey(filePath));
}

/**
 * Every artifact recorded this session, in creation order (Map preserves
 * insertion order). Returned as a copied array so callers can iterate — or
 * reverse it to roll back most-recent-first — without mutating the ledger.
 *
 * Added for the multi-artifact create path (the data entity set writes four
 * files in one call): a caller that must undo the artifacts it already wrote
 * needs their paths, and `handleCreateD365File` returns only a human-readable
 * message, not the path it recorded.
 */
export function listCreatedArtifacts(): CreatedArtifact[] {
  return [...ledger.values()];
}

/**
 * Find a recorded artifact by its AOT object name, optionally narrowed by
 * object type. Matching is case-insensitive because AOT identifiers are
 * case-insensitive in X++ — the same reason `ledgerKey` lowercases paths.
 *
 * Returns the MOST RECENTLY recorded match: if a session created and rolled
 * back an object and then created it again, the live entry is the one that
 * matters. Returns undefined when nothing matches.
 */
export function findCreatedArtifactByName(
  objectName: string,
  objectType?: string,
): CreatedArtifact | undefined {
  if (!objectName) return undefined;
  const wantedName = objectName.toLowerCase();
  const wantedType = objectType?.toLowerCase();

  let found: CreatedArtifact | undefined;
  for (const entry of ledger.values()) {
    if (entry.objectName?.toLowerCase() !== wantedName) continue;
    if (wantedType && entry.objectType?.toLowerCase() !== wantedType) continue;
    found = entry; // keep scanning — last match wins
  }
  return found;
}

/** Test-only: reset the module singleton between cases. */
export function _clearCreatedArtifactLedger(): void {
  ledger.clear();
}
