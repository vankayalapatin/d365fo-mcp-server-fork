/**
 * Data entity set — Layer 3: source-table input resolver.
 *
 * Turns the two inputs an agent actually has (an entity name and a source table
 * name) into the fully-populated DataEntitySetOrchestratorInput that
 * createDataEntitySet consumes. Everything else — label, title fields, business
 * fields with their EDTs, entity key, model prefix — is READ from the source
 * table, never asked of the caller.
 *
 * Strictly read-only: the only metadata call is context.bridge.readTable().
 * No writes, no create path, no file I/O.
 *
 * ─── Two bridge shapes this has to work around ───────────────────────────────
 *
 * 1. readTable does NOT return TitleField1/TitleField2. This is not a gap in
 *    the TypeScript type — the C# MetadataReadService.ReadTable never maps them
 *    (Services/MetadataReadService.cs, TableInfoModel has no title fields), so
 *    they are absent on the wire. See docs/data-entity-set-findings.md §8.
 *    Resolution: `titleField1`/`titleField2` are OPTIONAL inputs. When the
 *    caller omits them we fall back to the first two business fields and push a
 *    WARNING onto the result — visibly, never silently. That heuristic happens
 *    to match the captured fixture (Name, Gender) and is a reasonable default,
 *    but it is a guess: a source table whose real TitleField1/2 are not its
 *    first two fields will produce staging XML that differs from what the VS
 *    wizard writes. Pass the title fields explicitly to make it exact.
 *    (Reading the source table's XML off disk would settle it authoritatively,
 *    but that is file I/O this layer is deliberately not allowed to do.)
 *
 * 2. BridgeIndexInfo.fields is typed `string[]` but the bridge actually sends
 *    `[{ dataField, includedColumn }]` — the C# IndexInfoModel holds a
 *    List<IndexFieldModel> (Models.cs). bridgeAdapter.ts's formatTable already
 *    works around this by accepting either shape; `indexFieldNames` below does
 *    the same rather than trusting the declared type.
 *
 * ─── The double-prefix trap (findings §2) ────────────────────────────────────
 *
 * This resolver supplies `modelPrefix` for NAME DERIVATION ONLY. It never
 * prepends the prefix to `entityName`: the caller's entity name already carries
 * it, and deriveDataEntitySetNames only ever STRIPS the prefix (to compute the
 * public entity/collection names). Re-adding it here is exactly the bug that
 * would turn ContosoTestRecordEntity into ContosoContosoTestRecordEntity.
 */

import type { XppServerContext } from '../../types/context.js';
import type { BridgeTableInfo } from '../../bridge/bridgeTypes.js';
import { resolveRegularObjectPrefixToken } from '../../utils/modelClassifier.js';
import { getConfigManager } from '../../utils/configManager.js';
import type { DataEntitySetFieldSpec } from './assemble.js';
import type { DataEntitySetOrchestratorInput } from './orchestrator.js';

/** Raised when the source table cannot be read or is unusable as an entity source. */
export class DataEntitySetResolveError extends Error {}

export interface ResolveDataEntitySetInputArgs {
  /** Entity AOT name the agent chose, e.g. "ContosoTestRecordEntity". */
  entityName: string;
  /** Source table AOT name to build the set from, e.g. "ContosoTestRecord". */
  sourceTable: string;

  /**
   * Explicit TitleField1/TitleField2. Optional ONLY because the bridge cannot
   * supply them (see the header). Pass them to guarantee fixture-exact staging
   * XML; omit them to accept the first-two-fields heuristic plus a warning.
   */
  titleField1?: string;
  titleField2?: string;

  /**
   * Override the entity key. Defaults to the source table's primary-index
   * fields, which is what the VS wizard uses (findings §3).
   */
  keyFields?: string[];

  /**
   * Model whose prefix is stripped to form the public entity/collection names.
   * Defaults to the ACTIVE model from ConfigManager — deliberately NOT the
   * source table's own model, which can differ (extending a Microsoft table
   * would otherwise yield an ApplicationSuite prefix for an object being
   * written into a custom model).
   */
  modelName?: string;

  // ── Passed straight through to the orchestrator / create path ──
  packageName?: string;
  packagePath?: string;
  projectPath?: string;
  solutionPath?: string;
  addToProject?: boolean;
}

export interface ResolveDataEntitySetInputResult {
  /** Ready to hand to createDataEntitySet unchanged. */
  input: DataEntitySetOrchestratorInput;
  /** Non-fatal issues the caller should surface — notably the title-field guess. */
  warnings: string[];
  /** The raw source table, for callers that want to report on it. */
  sourceTableInfo: BridgeTableInfo;
}

/**
 * Normalize one index's field list to plain names.
 *
 * Accepts both the declared `string[]` and the `{ dataField }` objects the
 * bridge really sends (see header note 2), and drops included columns — they
 * are covering-index payload, not key components.
 */
function indexFieldNames(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f: any) => !(f && typeof f === 'object' && f.includedColumn === true))
    .map((f: any) => (typeof f === 'string' ? f : f?.dataField ?? f?.name))
    .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
}

/** Map a bridge field to the set's field spec, omitting absent keys entirely. */
function toFieldSpec(field: BridgeTableInfo['fields'][number]): DataEntitySetFieldSpec {
  const spec: DataEntitySetFieldSpec = { name: field.name };
  if (field.extendedDataType) spec.extendedDataType = field.extendedDataType;
  if (field.enumType) spec.enumType = field.enumType;
  if (field.label) spec.label = field.label;
  return spec;
}

/**
 * Resolve the full orchestrator input from an entity name + a source table.
 * Read-only; throws DataEntitySetResolveError when the source table cannot
 * supply what the set needs.
 */
export async function resolveDataEntitySetInput(
  args: ResolveDataEntitySetInputArgs,
  context: XppServerContext,
): Promise<ResolveDataEntitySetInputResult> {
  const warnings: string[] = [];

  if (!args.entityName) throw new DataEntitySetResolveError('entityName is required');
  if (!args.sourceTable) throw new DataEntitySetResolveError('sourceTable is required');

  // ── Source table (the only metadata read) ──
  const bridge = context.bridge;
  if (!bridge?.isReady || !bridge.metadataAvailable) {
    throw new DataEntitySetResolveError(
      `Cannot read source table "${args.sourceTable}": the C# metadata bridge is unavailable. ` +
      `A data entity set is built from live table metadata (fields, EDTs, primary index), so this ` +
      `requires a Windows VM with the bridge running — it cannot be resolved from the SQLite index alone.`,
    );
  }

  let table: BridgeTableInfo | null;
  try {
    table = await bridge.readTable(args.sourceTable);
  } catch (e) {
    throw new DataEntitySetResolveError(
      `Failed to read source table "${args.sourceTable}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!table) {
    throw new DataEntitySetResolveError(
      `Source table "${args.sourceTable}" was not found. Check the name with ` +
      `search(query="${args.sourceTable}", type="table").`,
    );
  }

  // ── Business fields ──
  const businessFields = (table.fields ?? []).map(toFieldSpec);
  if (businessFields.length === 0) {
    throw new DataEntitySetResolveError(
      `Source table "${args.sourceTable}" has no fields, so no data entity can be mapped from it.`,
    );
  }

  // ── Entity key: the source table's primary index (findings §3) ──
  let keyFields = args.keyFields ?? [];
  if (keyFields.length === 0) {
    if (!table.primaryIndex) {
      throw new DataEntitySetResolveError(
        `Source table "${args.sourceTable}" has no PrimaryIndex, so the entity key cannot be derived. ` +
        `Pass keyFields explicitly, or set a primary index on the table first.`,
      );
    }
    const primary = (table.indexes ?? []).find(
      i => i.name?.toLowerCase() === table!.primaryIndex!.toLowerCase(),
    );
    if (!primary) {
      throw new DataEntitySetResolveError(
        `Source table "${args.sourceTable}" names PrimaryIndex "${table.primaryIndex}" but that index ` +
        `was not returned with the table. Pass keyFields explicitly.`,
      );
    }
    keyFields = indexFieldNames(primary.fields);
    if (keyFields.length === 0) {
      throw new DataEntitySetResolveError(
        `Primary index "${table.primaryIndex}" on "${args.sourceTable}" has no key fields. ` +
        `Pass keyFields explicitly.`,
      );
    }
  }

  // ── Label ──
  const label = table.label ?? '';
  if (!label) {
    warnings.push(
      `Source table "${args.sourceTable}" has no Label, so the entity and staging table will be ` +
      `created without one. The VS wizard copies the source table's label.`,
    );
  }

  // ── Title fields: not available from the bridge (see header note 1) ──
  let { titleField1, titleField2 } = args;
  if (titleField1 === undefined || titleField2 === undefined) {
    const fallback1 = businessFields[0]?.name ?? '';
    const fallback2 = businessFields[1]?.name ?? '';
    titleField1 = titleField1 ?? fallback1;
    titleField2 = titleField2 ?? fallback2;
    warnings.push(
      `TitleField1/TitleField2 are not returned by the metadata bridge, so they were guessed from the ` +
      `first two fields of "${args.sourceTable}" (${titleField1 || '(none)'}, ${titleField2 || '(none)'}). ` +
      `If the source table's real title fields differ, the staging table will diverge from what the VS ` +
      `wizard writes — pass titleField1/titleField2 explicitly to make it exact.`,
    );
  }

  // ── Model prefix, from the ACTIVE model — never asked of the caller ──
  let modelName = args.modelName;
  if (!modelName) {
    try {
      modelName = (await getConfigManager().getAutoDetectedModelName()) ?? undefined;
    } catch {
      modelName = undefined;
    }
  }
  const modelPrefix = resolveRegularObjectPrefixToken(modelName);

  if (modelPrefix && !args.entityName.startsWith(modelPrefix)) {
    warnings.push(
      `Entity name "${args.entityName}" does not start with the resolved model prefix "${modelPrefix}". ` +
      `The public entity/collection names will therefore keep the full name rather than a stripped one. ` +
      `Check that the entity name carries the model prefix.`,
    );
  }

  const input: DataEntitySetOrchestratorInput = {
    entityName: args.entityName,
    modelPrefix,
    sourceTable: args.sourceTable,
    label,
    titleField1,
    titleField2,
    businessFields,
    keyFields,
    // Passthrough — only include what was actually supplied, so the object stays
    // free of undefined keys the create path would have to filter out again.
    ...(args.modelName !== undefined ? { modelName: args.modelName } : {}),
    ...(args.packageName !== undefined ? { packageName: args.packageName } : {}),
    ...(args.packagePath !== undefined ? { packagePath: args.packagePath } : {}),
    ...(args.projectPath !== undefined ? { projectPath: args.projectPath } : {}),
    ...(args.solutionPath !== undefined ? { solutionPath: args.solutionPath } : {}),
    ...(args.addToProject !== undefined ? { addToProject: args.addToProject } : {}),
  };

  return { input, warnings, sourceTableInfo: table };
}
