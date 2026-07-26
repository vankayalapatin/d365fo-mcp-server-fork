/**
 * Data entity set — Layer 1: pure assembly.
 *
 * Takes the tool's inputs, derives every name ONCE via deriveDataEntitySetNames,
 * and feeds that single derivation into the entity, staging-table, and privilege
 * builders. Returns the four artifacts as plain { objectName, objectType, xml }
 * records.
 *
 * Strictly no I/O: no file writes, no bridge, no symbol-index reads. Everything
 * that touches disk lives in Layer 2 (./orchestrator.ts). Keeping the assembly
 * pure is what lets the byte-for-byte fixture test run the REAL entry point
 * rather than a stand-in.
 *
 * Artifact order is dependency order (findings §8): the entity comes first
 * because the staging table's foreign key and both privileges reference it by
 * name. Layer 2 writes them in exactly this order.
 *
 * One field list, three uses (findings §8): the caller supplies a single
 * `businessFields` array which is projected into
 *   - the entity's AxDataEntityViewMappedField entries (name + dataField)
 *   - the staging table's business fields (EDT / enum type / label)
 *   - the staging table's FK constraints (via keyFields, which name entries in it)
 * so the three artifacts cannot disagree about the field set.
 */

import { deriveDataEntitySetNames, type DataEntitySetNames } from './names.js';
import { buildDataEntitySetEntityXml, type DataEntityFieldSpec } from './entityXml.js';
import { buildDataEntitySetStagingTableXml, type DataEntityBusinessFieldSpec } from './stagingTableXml.js';
import { buildDataEntitySetPrivilegeXml } from './privilegeXml.js';

/**
 * A selected business field. Carries everything BOTH the entity and the staging
 * table need, so the caller states the field set once.
 */
export interface DataEntitySetFieldSpec {
  /** Field name, as it appears on the entity and the staging table. */
  name: string;
  /** Source-table field name, when it differs from `name` (entity mapping only). */
  dataField?: string;
  /** Copied from the source table field — staging table only. */
  extendedDataType?: string;
  /** Copied from the source table field — staging table only; presence implies an enum field. */
  enumType?: string;
  /** Copied from the source table field — staging table only. */
  label?: string;
}

export interface DataEntitySetAssembleInput {
  /** Entity AOT name, e.g. "ContosoTestRecordEntity". */
  entityName: string;
  /** Model prefix, e.g. "Contoso" — used only to strip the public entity/collection names. */
  modelPrefix: string;
  /** Source table AOT name, e.g. "ContosoTestRecord". */
  sourceTable: string;
  /** Label, copied verbatim from the source table — shared by the entity and the staging table. */
  label: string;
  /** Copied from the source table's TitleField1 — staging table only. */
  titleField1: string;
  /** Copied from the source table's TitleField2 — staging table only. */
  titleField2: string;
  /** Selected business fields, in wizard-grid order. Reserved/system fields must already be filtered out (Layer 2). */
  businessFields: DataEntitySetFieldSpec[];
  /** Field names forming the entity key, derived from the source table's primary index. */
  keyFields: string[];
}

/** AOT object types, matching d365fo_file(action="create")'s objectType enum. */
export type DataEntitySetArtifactType = 'data-entity' | 'table' | 'security-privilege';

export interface DataEntitySetArtifact {
  /** Resolved AOT object name — the file will be written as <objectName>.xml. */
  objectName: string;
  /** objectType to pass to d365fo_file(action="create"). */
  objectType: DataEntitySetArtifactType;
  /** Complete XML document for the artifact. */
  xml: string;
}

export interface DataEntitySetAssembly {
  /** The single name derivation every artifact was built from. */
  names: DataEntitySetNames;
  /** The four artifacts, in dependency (write) order: entity, staging, view, maintain. */
  artifacts: DataEntitySetArtifact[];
}

function toEntityFieldSpec(field: DataEntitySetFieldSpec): DataEntityFieldSpec {
  return { name: field.name, dataField: field.dataField };
}

function toStagingFieldSpec(field: DataEntitySetFieldSpec): DataEntityBusinessFieldSpec {
  return {
    name: field.name,
    extendedDataType: field.extendedDataType,
    enumType: field.enumType,
    label: field.label,
  };
}

/**
 * Assemble the complete four-artifact data entity set. Pure — returns XML
 * strings, writes nothing.
 */
export function assembleDataEntitySet(input: DataEntitySetAssembleInput): DataEntitySetAssembly {
  const {
    entityName, modelPrefix, sourceTable, label,
    titleField1, titleField2, businessFields, keyFields,
  } = input;

  if (businessFields.length === 0) {
    throw new Error('assembleDataEntitySet: at least one business field is required');
  }
  if (keyFields.length === 0) {
    throw new Error('assembleDataEntitySet: at least one key field is required');
  }

  // Every key field must name a selected business field — otherwise the entity's
  // <Keys>, the staging StagingIdx tail, and the FK constraints would all
  // reference a field that exists on none of the three artifacts.
  const fieldNames = new Set(businessFields.map(f => f.name));
  const unknownKeyFields = keyFields.filter(k => !fieldNames.has(k));
  if (unknownKeyFields.length > 0) {
    throw new Error(
      `assembleDataEntitySet: key field(s) ${unknownKeyFields.join(', ')} are not among the selected ` +
      `business fields (${[...fieldNames].join(', ')})`,
    );
  }

  // Derived ONCE and threaded into all four builders.
  const names = deriveDataEntitySetNames(entityName, modelPrefix);

  const entityXml = buildDataEntitySetEntityXml({
    names,
    primaryTable: sourceTable,
    label,
    fields: businessFields.map(toEntityFieldSpec),
    keyFields,
  });

  const stagingTableXml = buildDataEntitySetStagingTableXml({
    names,
    label,
    titleField1,
    titleField2,
    businessFields: businessFields.map(toStagingFieldSpec),
    keyFields,
  });

  const { viewPrivilegeXml, maintainPrivilegeXml } = buildDataEntitySetPrivilegeXml(names);

  return {
    names,
    artifacts: [
      { objectName: names.entityName, objectType: 'data-entity', xml: entityXml },
      { objectName: names.stagingTableName, objectType: 'table', xml: stagingTableXml },
      { objectName: names.viewPrivilegeName, objectType: 'security-privilege', xml: viewPrivilegeXml },
      { objectName: names.maintainPrivilegeName, objectType: 'security-privilege', xml: maintainPrivilegeXml },
    ],
  };
}
