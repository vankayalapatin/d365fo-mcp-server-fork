/**
 * Data entity set — name derivation.
 *
 * Today, `buildAxDataEntityXml` (../dataEntityXml.ts) does NOT derive names: it
 * takes `properties.publicEntityName` / `properties.publicCollectionName` from
 * the caller and defaults them independently —
 *   publicEntityName     defaults to the entityName itself
 *   publicCollectionName defaults to `${entityName}Collection`
 * (see dataEntityXml.ts:32-33). There is no staging table or privilege naming
 * anywhere in the repo; every artifact today is named by the caller in
 * isolation, one d365fo_file(action="create") call at a time.
 *
 * Ground truth captured from the real VS Data Entity Wizard
 * (docs/data-entity-set-findings.md §2) shows those defaults are wrong and
 * that all four artifact names are mechanically derivable from the entity's
 * AOT name plus the model prefix:
 *   - staging table name        = {entityName minus trailing "Entity"}Staging
 *                                 (derived from entityName ONLY — the prefix is
 *                                 never re-added; entityName already carries it
 *                                 when present, so re-adding risks double-prefixing)
 *   - view / maintain privilege = {entityName}View / {entityName}Maintain
 *   - public entity name        = the un-prefixed, Entity-suffix-stripped base
 *   - public collection name    = identical to the public entity name
 *
 * This module is the single derivation point for those four names, so the
 * orchestrator (not yet written) and any future caller can't drift from the
 * verified fixture set in tests/fixtures/data-entity/.
 */

const ENTITY_SUFFIX = 'Entity';

export interface DataEntitySetNames {
  /** The AOT name of the entity itself, echoed back unchanged. */
  entityName: string;
  /** Un-prefixed, Entity-suffix-stripped base — e.g. "TestRecord" for "ContosoTestRecordEntity". */
  baseName: string;
  /**
   * entityName with a trailing "Entity" suffix stripped, then "Staging" appended
   * — e.g. "ContosoTestRecordStaging" for "ContosoTestRecordEntity". Derived from
   * entityName alone; the prefix is never separately re-applied.
   */
  stagingTableName: string;
  /** {entityName}View — e.g. "ContosoTestRecordEntityView". */
  viewPrivilegeName: string;
  /** {entityName}Maintain — e.g. "ContosoTestRecordEntityMaintain". */
  maintainPrivilegeName: string;
  /** Same value as baseName — kept as a separate field because AxDataEntityView has two elements. */
  publicEntityName: string;
  /** Verified identical to publicEntityName (data-entity-set-findings.md §2). */
  publicCollectionName: string;
}

/**
 * Derive the staging table, privilege, and public-name pair from an already-named
 * entity and its model prefix. Pure function — no I/O, no bridge, no XML.
 *
 * `modelPrefix` is matched against the START of `entityName` case-sensitively:
 * prefixes are applied verbatim by applyObjectPrefix (../../utils/modelClassifier.ts),
 * so a case-insensitive strip here would risk mangling a name that merely happens
 * to share casing with the prefix rather than actually carrying it.
 */
export function deriveDataEntitySetNames(entityName: string, modelPrefix: string): DataEntitySetNames {
  if (!entityName) {
    throw new Error('deriveDataEntitySetNames: entityName is required');
  }

  const unprefixed = modelPrefix && entityName.startsWith(modelPrefix)
    ? entityName.slice(modelPrefix.length)
    : entityName;

  const baseName = unprefixed.endsWith(ENTITY_SUFFIX)
    ? unprefixed.slice(0, -ENTITY_SUFFIX.length)
    : unprefixed;

  // Staging table name comes from entityName directly — NOT from baseName/prefix
  // arithmetic. entityName already carries the prefix when one applies; rebuilding
  // it from a separately-stripped prefix + base risks double-prefixing (§2).
  const entityBase = entityName.endsWith(ENTITY_SUFFIX)
    ? entityName.slice(0, -ENTITY_SUFFIX.length)
    : entityName;

  return {
    entityName,
    baseName,
    stagingTableName: `${entityBase}Staging`,
    viewPrivilegeName: `${entityName}View`,
    maintainPrivilegeName: `${entityName}Maintain`,
    publicEntityName: baseName,
    publicCollectionName: baseName,
  };
}
