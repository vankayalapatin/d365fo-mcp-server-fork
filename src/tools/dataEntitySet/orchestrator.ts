/**
 * Data entity set — Layer 2: the orchestrating handler.
 *
 * Sequences the four artifacts assembled by ./assemble.ts through the EXISTING
 * single-file create path (handleCreateD365File), and rolls back what it already
 * wrote when a later write fails.
 *
 * Deliberately adds no I/O of its own:
 *   - writing goes through handleCreateD365File, exactly as the current
 *     single-file data-entity create does. Passing `xmlContent` short-circuits
 *     the C# bridge before `canBridgeCreate` is even consulted, so the staging
 *     table (objectType "table", normally bridge-eligible) takes the same
 *     TypeScript path as the other three. Nothing here touches the bridge.
 *   - rollback goes through rollbackCreatedArtifact (../rollbackCreatedArtifact.ts),
 *     the session-ledger primitive undo_last_modification uses.
 *
 * Write order is the assembly's dependency order — entity first, because the
 * staging table's foreign key and both privileges reference it by name.
 * Rollback runs in strict reverse.
 */

import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { XppServerContext } from '../../types/context.js';
import { handleCreateD365File } from '../createD365File.js';
import {
  listCreatedArtifacts,
  findCreatedArtifactByName,
  ledgerKey,
} from '../createdArtifactLedger.js';
import { rollbackCreatedArtifact, type RollbackCreatedArtifactOutcome } from '../rollbackCreatedArtifact.js';
import {
  assembleDataEntitySet,
  type DataEntitySetArtifactType,
  type DataEntitySetFieldSpec,
} from './assemble.js';

/**
 * System/reserved field names that must never appear as entity or staging
 * fields (findings §6). `DataAreaId` in particular is offered by the VS wizard's
 * grid but produces XML that fails to build:
 *   "Invalid field name; 'DataAreaId' is reserved for system fields."
 * Company context is expressed by the entity's PrimaryCompanyContext property
 * instead. Filtering these out is the documented improvement over the wizard.
 */
export const RESERVED_FIELD_NAMES = [
  'DataAreaId',
  'RecId',
  'RecVersion',
  'Partition',
] as const;

const RESERVED_FIELD_SET = new Set<string>(RESERVED_FIELD_NAMES.map(n => n.toLowerCase()));

export interface ReservedFieldFilterResult {
  /** Fields safe to build from. */
  kept: DataEntitySetFieldSpec[];
  /** Field names removed, in the order they appeared. */
  dropped: string[];
}

/**
 * Drop reserved/system fields from a selection. Case-insensitive: AOT
 * identifiers are case-insensitive in X++, so "dataareaid" is just as invalid
 * as "DataAreaId".
 */
export function filterReservedFields(fields: DataEntitySetFieldSpec[]): ReservedFieldFilterResult {
  const kept: DataEntitySetFieldSpec[] = [];
  const dropped: string[] = [];

  for (const field of fields) {
    if (RESERVED_FIELD_SET.has(field.name.toLowerCase())) {
      dropped.push(field.name);
    } else {
      kept.push(field);
    }
  }

  return { kept, dropped };
}

export type ArtifactStatus =
  /** Written successfully and still on disk. */
  | 'created'
  /** This artifact's own write failed. */
  | 'failed'
  /** Written earlier, then removed because a later write failed. */
  | 'rolled-back'
  /** Written earlier, but rollback could not remove it — needs manual cleanup. */
  | 'rollback-failed'
  /** Never attempted, because an earlier artifact failed. */
  | 'not-attempted';

export interface DataEntitySetArtifactResult {
  objectName: string;
  objectType: DataEntitySetArtifactType;
  status: ArtifactStatus;
  /** Absolute path, once the create recorded one in the session ledger. */
  filePath?: string;
  /** The create tool's message for a failure, or the rollback detail. */
  message?: string;
  /** Raw outcome from rollbackCreatedArtifact, when a rollback was attempted. */
  rollbackStatus?: RollbackCreatedArtifactOutcome['status'];
}

export interface DataEntitySetResult {
  /** True only when all four artifacts were created and none rolled back. */
  success: boolean;
  artifacts: DataEntitySetArtifactResult[];
  /** Reserved/system field names removed from the selection before assembly. */
  droppedFields: string[];
  /** Human-readable recap, suitable for wrapping in an MCP text response. */
  summary: string;
}

export interface DataEntitySetOrchestratorInput {
  /** Entity AOT name, e.g. "ContosoTestRecordEntity". */
  entityName: string;
  /** Model prefix, e.g. "Contoso". */
  modelPrefix: string;
  /** Source table AOT name, e.g. "ContosoTestRecord". */
  sourceTable: string;
  /** Label copied from the source table. */
  label: string;
  /** Copied from the source table's TitleField1. */
  titleField1: string;
  /** Copied from the source table's TitleField2. */
  titleField2: string;
  /** Selected business fields — reserved names are filtered out before assembly. */
  businessFields: DataEntitySetFieldSpec[];
  /** Entity key field names, from the source table's primary index. */
  keyFields: string[];

  // ── Passed through to handleCreateD365File unchanged ──
  modelName?: string;
  packageName?: string;
  packagePath?: string;
  projectPath?: string;
  solutionPath?: string;
  /** Defaults to handleCreateD365File's own default (true) when omitted. */
  addToProject?: boolean;
}

/** Thrown before any write when the inputs cannot produce a buildable set. */
export class DataEntitySetInputError extends Error {}

function createRequest(
  objectType: DataEntitySetArtifactType,
  objectName: string,
  xml: string,
  input: DataEntitySetOrchestratorInput,
): CallToolRequest {
  return {
    method: 'tools/call',
    params: {
      name: 'd365fo_file',
      arguments: {
        action: 'create',
        objectType,
        objectName,
        xmlContent: xml,
        ...(input.modelName !== undefined ? { modelName: input.modelName } : {}),
        ...(input.packageName !== undefined ? { packageName: input.packageName } : {}),
        ...(input.packagePath !== undefined ? { packagePath: input.packagePath } : {}),
        ...(input.projectPath !== undefined ? { projectPath: input.projectPath } : {}),
        ...(input.solutionPath !== undefined ? { solutionPath: input.solutionPath } : {}),
        ...(input.addToProject !== undefined ? { addToProject: input.addToProject } : {}),
      },
    },
  };
}

/**
 * Resolve the path the create tool just recorded for `objectName`.
 *
 * Primary strategy is a ledger DIFF rather than a name lookup: createD365File
 * runs the requested objectName through applyObjectPrefix, so the name it
 * records can legitimately differ from the one we passed, and a by-name lookup
 * would then miss. Whatever entry appeared since the snapshot is the one this
 * create just wrote (a create records exactly one artifact, and only when the
 * file did not already exist).
 *
 * Falls back to the by-name lookup when the diff is empty — e.g. a create that
 * legitimately recorded nothing because it overwrote an existing file, in which
 * case there may still be an older entry under the same name.
 */
function resolveRecordedPath(
  keysBefore: Set<string>,
  objectName: string,
  objectType: DataEntitySetArtifactType,
): string | undefined {
  const newEntries = listCreatedArtifacts().filter(a => !keysBefore.has(ledgerKey(a.filePath)));
  if (newEntries.length === 1) return newEntries[0].filePath;
  if (newEntries.length > 1) {
    // More than one new entry is unexpected; prefer the one matching our name.
    const match = newEntries.find(a => a.objectName?.toLowerCase() === objectName.toLowerCase());
    return (match ?? newEntries[newEntries.length - 1]).filePath;
  }
  return findCreatedArtifactByName(objectName, objectType)?.filePath;
}

function renderSummary(result: Omit<DataEntitySetResult, 'summary'>): string {
  const icon: Record<ArtifactStatus, string> = {
    'created': '✅',
    'failed': '❌',
    'rolled-back': '↩️',
    'rollback-failed': '⚠️',
    'not-attempted': '⏭️',
  };

  const lines = result.artifacts.map(a => {
    const detail = a.message ? ` — ${a.message.split('\n')[0]}` : '';
    return `  ${icon[a.status]} ${a.objectType.padEnd(18)} ${a.objectName} [${a.status}]${detail}`;
  });

  const header = result.success
    ? `✅ Data entity set created — all ${result.artifacts.length} artifacts written.`
    : `❌ Data entity set FAILED — the set is incomplete.`;

  const droppedNote = result.droppedFields.length > 0
    ? `\n\nℹ️ Reserved system field(s) excluded from the set: ${result.droppedFields.join(', ')}. ` +
      `Company context is expressed by the entity's PrimaryCompanyContext property, never as a field.`
    : '';

  const manualNote = result.artifacts.some(a => a.status === 'rollback-failed')
    ? `\n\n⚠️ One or more artifacts could NOT be rolled back automatically and are still on disk. ` +
      `Remove them manually before retrying.`
    : '';

  return `${header}\n\n${lines.join('\n')}${droppedNote}${manualNote}`;
}

/**
 * Create a complete data entity set: entity, DMF staging table, and the view +
 * maintain privileges. All-or-nothing by intent — a failure part-way rolls back
 * the artifacts already written, in reverse order.
 *
 * Rollback is best-effort compensating deletes, not a transaction: it can only
 * remove files this session's create path recorded in the ledger. Any artifact
 * it cannot remove is reported as 'rollback-failed' rather than silently
 * counted as clean.
 */
export async function createDataEntitySet(
  input: DataEntitySetOrchestratorInput,
  context: XppServerContext,
): Promise<DataEntitySetResult> {
  // ── Reserved-field guard, before anything is assembled or written ──
  const { kept, dropped } = filterReservedFields(input.businessFields);

  const droppedKeyFields = input.keyFields.filter(k =>
    dropped.some(d => d.toLowerCase() === k.toLowerCase()),
  );
  if (droppedKeyFields.length > 0) {
    throw new DataEntitySetInputError(
      `Key field(s) ${droppedKeyFields.join(', ')} are reserved system fields and cannot form an entity key. ` +
      `Reserved fields: ${RESERVED_FIELD_NAMES.join(', ')}. ` +
      `Choose a business field for the key — company context is expressed by the entity's ` +
      `PrimaryCompanyContext property, not by a DataAreaId key.`,
    );
  }

  // Throws (before any write) when the remaining selection can't build a set.
  const { artifacts } = assembleDataEntitySet({
    entityName: input.entityName,
    modelPrefix: input.modelPrefix,
    sourceTable: input.sourceTable,
    label: input.label,
    titleField1: input.titleField1,
    titleField2: input.titleField2,
    businessFields: kept,
    keyFields: input.keyFields,
  });

  const results: DataEntitySetArtifactResult[] = artifacts.map(a => ({
    objectName: a.objectName,
    objectType: a.objectType,
    status: 'not-attempted' as ArtifactStatus,
  }));

  // ── Write in dependency order, stopping at the first failure ──
  let failedIndex = -1;

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    const keysBefore = new Set(listCreatedArtifacts().map(a => ledgerKey(a.filePath)));

    let createResult: { content: Array<{ type: string; text: string }>; isError?: boolean };
    try {
      createResult = await handleCreateD365File(
        createRequest(artifact.objectType, artifact.objectName, artifact.xml, input),
        context,
      );
    } catch (e) {
      results[i].status = 'failed';
      results[i].message = e instanceof Error ? e.message : String(e);
      failedIndex = i;
      break;
    }

    if (createResult.isError) {
      results[i].status = 'failed';
      results[i].message = createResult.content?.[0]?.text ?? 'create returned isError with no message';
      failedIndex = i;
      break;
    }

    results[i].status = 'created';
    results[i].filePath = resolveRecordedPath(keysBefore, artifact.objectName, artifact.objectType);
  }

  if (failedIndex === -1) {
    const base = { success: true, artifacts: results, droppedFields: dropped };
    return { ...base, summary: renderSummary(base) };
  }

  // ── Roll back everything already written, most recent first ──
  for (let i = failedIndex - 1; i >= 0; i--) {
    const record = results[i];
    if (record.status !== 'created') continue;

    if (!record.filePath) {
      // Created, but the create recorded no path — rollback has nothing to act on.
      record.status = 'rollback-failed';
      record.message = 'created but no ledger entry was recorded, so it could not be removed automatically';
      continue;
    }

    try {
      const outcome = await rollbackCreatedArtifact(record.filePath, context);
      record.rollbackStatus = outcome.status;

      if (outcome.status === 'rolled-back' || outcome.status === 'already-absent') {
        record.status = 'rolled-back';
      } else {
        record.status = 'rollback-failed';
        record.message = outcome.status === 'not-recorded'
          ? 'not present in the session ledger, so it was left untouched'
          : 'path is not a regular file, so it was left untouched';
      }
    } catch (e) {
      record.status = 'rollback-failed';
      record.message = `rollback threw: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const base = { success: false, artifacts: results, droppedFields: dropped };
  return { ...base, summary: renderSummary(base) };
}
