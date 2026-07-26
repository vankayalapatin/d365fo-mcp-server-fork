/**
 * Data entity set — AxTable (staging table) builder.
 *
 * Ground truth: docs/data-entity-set-findings.md §1 and §4, captured from the
 * real VS Data Entity Wizard. Verified against
 * tests/fixtures/data-entity/ContosoTestRecordStaging.xml byte-for-byte
 * (tests/tools/dataEntitySet/stagingTableXml.test.ts).
 *
 * Golden rule (findings §1) still applies: only what's in the fixture is
 * emitted. In particular this table has NO Declaration (unlike the entity's
 * SourceCode, findings §4), NO TableType and NO CacheLookup element at all —
 * their absence IS the verified value (Regular / omitted), not something this
 * builder chooses to leave out arbitrarily.
 *
 * Three details that are easy to get wrong, called out because they contradict
 * what a generic "staging table" implementation would guess:
 *   1. EVERY field — the four DMF fields AND the business fields copied from
 *      the source table — carries <IsSystemGenerated>Yes</IsSystemGenerated>
 *      here, even though the business fields do NOT carry it on the source
 *      table itself. This is a staging-table-only marker, not a copy of the
 *      source field's own IsSystemGenerated (which the source table fixture
 *      doesn't even have).
 *   2. The ExtensionList field group's <Fields> ORDER is
 *      DefinitionGroup, IsSelected, TransferStatus, ExecutionId — NOT the same
 *      order as the top-level <Fields> node (DefinitionGroup, ExecutionId,
 *      IsSelected, TransferStatus). This is deliberately hard-coded to match;
 *      do not derive it from DMF_FIELDS order.
 *   3. <Relations> is NOT empty. One AxTableRelationForeignKey named
 *      "DataEntity" points back at the entity, previously missing from every
 *      earlier design pass (findings §4, §8).
 *
 * Per-field element order (Name, AllowEdit, ExtendedDataType, IsSystemGenerated,
 * EnumType, Mandatory, Label, StringSize — each included only when the field
 * actually has it) was reverse-engineered from all six captured fields in the
 * fixture, DMF and business alike; buildStagingFieldXml is the single place
 * that order is encoded.
 */

import type { DataEntitySetNames } from './names.js';

export interface DataEntityBusinessFieldSpec {
  /** Field name — must match the corresponding AxDataEntityViewMappedField's DataField. */
  name: string;
  /** Copied from the source table field, when present. */
  extendedDataType?: string;
  /** Copied from the source table field, when present — presence implies AxTableFieldEnum. */
  enumType?: string;
  /** Copied from the source table field, when present. */
  label?: string;
}

export interface DataEntitySetStagingTableInput {
  /** Names derived by deriveDataEntitySetNames — the single naming source of truth. */
  names: DataEntitySetNames;
  /** Staging Label — copied verbatim from the source table's label (findings §4, same value as the entity's). */
  label: string;
  /** Copied from the source table's TitleField1. */
  titleField1: string;
  /** Copied from the source table's TitleField2. */
  titleField2: string;
  /** Business fields, copied from the source table, in the same order used for the entity. */
  businessFields: DataEntityBusinessFieldSpec[];
  /** Field `name`s forming the entity key — MUST match what buildDataEntitySetEntityXml was given. */
  keyFields: string[];
}

interface StagingFieldXmlSpec {
  name: string;
  iType: 'AxTableFieldString' | 'AxTableFieldEnum';
  allowEdit?: 'No';
  extendedDataType?: string;
  enumType?: string;
  mandatory?: boolean;
  label?: string;
  stringSize?: number;
}

/**
 * The four DMF system fields, fixed and always present, in this exact order
 * (findings §4). Every DMF field is IsSystemGenerated — added unconditionally
 * inside buildStagingFieldXml, not listed here.
 */
const DMF_FIELDS: StagingFieldXmlSpec[] = [
  { name: 'DefinitionGroup', iType: 'AxTableFieldString', allowEdit: 'No', extendedDataType: 'DMFDefinitionGroupName', mandatory: true, stringSize: 60 },
  { name: 'ExecutionId', iType: 'AxTableFieldString', allowEdit: 'No', extendedDataType: 'DMFExecutionId', mandatory: true, stringSize: 90 },
  { name: 'IsSelected', iType: 'AxTableFieldEnum', extendedDataType: 'DMFIsSelected', enumType: 'NoYes' },
  { name: 'TransferStatus', iType: 'AxTableFieldEnum', enumType: 'DMFTransferStatus' },
];

/**
 * Six field groups the wizard always emits on the staging table — the same
 * five auto groups as the entity/source table but with IsSystemGenerated
 * added, plus a sixth ExtensionList group. Fully constant: none of the six
 * groups reference business fields, so this never varies with input.
 *
 * ExtensionList's field order (DefinitionGroup, IsSelected, TransferStatus,
 * ExecutionId) intentionally does NOT match DMF_FIELDS order — see file header.
 */
const FIELD_GROUPS_XML = `\t<FieldGroups>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoReport</Name>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoLookup</Name>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoIdentification</Name>
\t\t\t<AutoPopulate>Yes</AutoPopulate>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoSummary</Name>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoBrowse</Name>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>ExtensionList</Name>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Label>@DMF:StagingExtensionGroup</Label>
\t\t\t<Fields>
\t\t\t\t<AxTableFieldGroupField>
\t\t\t\t\t<DataField>DefinitionGroup</DataField>
\t\t\t\t</AxTableFieldGroupField>
\t\t\t\t<AxTableFieldGroupField>
\t\t\t\t\t<DataField>IsSelected</DataField>
\t\t\t\t</AxTableFieldGroupField>
\t\t\t\t<AxTableFieldGroupField>
\t\t\t\t\t<DataField>TransferStatus</DataField>
\t\t\t\t</AxTableFieldGroupField>
\t\t\t\t<AxTableFieldGroupField>
\t\t\t\t\t<DataField>ExecutionId</DataField>
\t\t\t\t</AxTableFieldGroupField>
\t\t\t</Fields>
\t\t</AxTableFieldGroup>
\t</FieldGroups>`;

/**
 * Element order: Name, AllowEdit, ExtendedDataType, IsSystemGenerated,
 * EnumType, Mandatory, Label, StringSize — each included only when present on
 * `spec`. Reverse-engineered from every field in the fixture (findings §4);
 * IsSystemGenerated is unconditional (every field on this table carries it).
 */
function buildStagingFieldXml(spec: StagingFieldXmlSpec): string {
  const lines: string[] = [`\t\t\t<Name>${spec.name}</Name>`];
  if (spec.allowEdit) lines.push(`\t\t\t<AllowEdit>${spec.allowEdit}</AllowEdit>`);
  if (spec.extendedDataType) lines.push(`\t\t\t<ExtendedDataType>${spec.extendedDataType}</ExtendedDataType>`);
  lines.push(`\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>`);
  if (spec.enumType) lines.push(`\t\t\t<EnumType>${spec.enumType}</EnumType>`);
  if (spec.mandatory) lines.push(`\t\t\t<Mandatory>Yes</Mandatory>`);
  if (spec.label) lines.push(`\t\t\t<Label>${spec.label}</Label>`);
  if (spec.stringSize !== undefined) lines.push(`\t\t\t<StringSize>${spec.stringSize}</StringSize>`);

  return `\t\t<AxTableField xmlns=""
\t\t\ti:type="${spec.iType}">
${lines.join('\n')}
\t\t</AxTableField>`;
}

function businessFieldToStagingSpec(field: DataEntityBusinessFieldSpec, isKeyField: boolean): StagingFieldXmlSpec {
  return {
    name: field.name,
    iType: field.enumType ? 'AxTableFieldEnum' : 'AxTableFieldString',
    extendedDataType: field.extendedDataType,
    enumType: field.enumType,
    mandatory: isKeyField,
    label: field.label,
  };
}

function buildIndexFieldXml(fieldName: string): string {
  return `\t\t\t\t<AxTableIndexField>
\t\t\t\t\t<DataField>${fieldName}</DataField>
\t\t\t\t</AxTableIndexField>`;
}

/**
 * StagingIdx = DefinitionGroup, ExecutionId, then the entity's key field(s),
 * in that order (findings §4).
 */
function buildIndexesXml(keyFields: string[]): string {
  const indexFields = ['DefinitionGroup', 'ExecutionId', ...keyFields];
  const indexFieldsXml = indexFields.map(buildIndexFieldXml).join('\n');
  return `\t<Indexes>
\t\t<AxTableIndex>
\t\t\t<Name>StagingIdx</Name>
\t\t\t<AlternateKey>Yes</AlternateKey>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<Fields>
${indexFieldsXml}
\t\t\t</Fields>
\t\t</AxTableIndex>
\t</Indexes>`;
}

function buildRelationConstraintXml(fieldName: string): string {
  return `\t\t\t\t<AxTableRelationConstraint xmlns=""
\t\t\t\t\ti:type="AxTableRelationConstraintField">
\t\t\t\t\t<Name>${fieldName}</Name>
\t\t\t\t\t<Field>${fieldName}</Field>
\t\t\t\t\t<RelatedField>${fieldName}</RelatedField>
\t\t\t\t</AxTableRelationConstraint>`;
}

/**
 * The foreign-key relation back to the entity — previously missing from every
 * earlier design pass (findings §4, §8). One constraint per entity key field.
 */
function buildRelationsXml(entityName: string, keyFields: string[]): string {
  const constraintsXml = keyFields.map(buildRelationConstraintXml).join('\n');
  return `\t<Relations>
\t\t<AxTableRelation xmlns=""
\t\t\ti:type="AxTableRelationForeignKey">
\t\t\t<Name>DataEntity</Name>
\t\t\t<Cardinality>ExactlyOne</Cardinality>
\t\t\t<EntityRelationshipRole>@DMF:StagingToDataEntityRelationshipRole</EntityRelationshipRole>
\t\t\t<IsSystemGenerated>Yes</IsSystemGenerated>
\t\t\t<RelatedTable>${entityName}</RelatedTable>
\t\t\t<RelatedTableCardinality>ZeroOne</RelatedTableCardinality>
\t\t\t<RelationshipType>Link</RelationshipType>
\t\t\t<Validate>No</Validate>
\t\t\t<Constraints>
${constraintsXml}
\t\t\t</Constraints>
\t\t</AxTableRelation>
\t</Relations>`;
}

export function buildDataEntitySetStagingTableXml(input: DataEntitySetStagingTableInput): string {
  const { names, label, titleField1, titleField2, businessFields, keyFields } = input;

  if (keyFields.length === 0) {
    throw new Error('buildDataEntitySetStagingTableXml: at least one key field is required');
  }

  const keyFieldSet = new Set(keyFields);
  const businessFieldsXml = businessFields
    .map(f => buildStagingFieldXml(businessFieldToStagingSpec(f, keyFieldSet.has(f.name))))
    .join('\n');
  const dmfFieldsXml = DMF_FIELDS.map(buildStagingFieldXml).join('\n');
  const fieldsXml = businessFieldsXml ? `${dmfFieldsXml}\n${businessFieldsXml}` : dmfFieldsXml;

  return `<?xml version="1.0" encoding="utf-8"?>
<AxTable xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${names.stagingTableName}</Name>
\t<SourceCode>
\t\t<Methods />
\t</SourceCode>
\t<DeveloperDocumentation>@DMF:StagingDeveloperDocumentation</DeveloperDocumentation>
\t<Label>${label}</Label>
\t<TableGroup>Staging</TableGroup>
\t<TitleField1>${titleField1}</TitleField1>
\t<TitleField2>${titleField2}</TitleField2>
\t<PrimaryIndex>StagingIdx</PrimaryIndex>
\t<ReplacementKey>StagingIdx</ReplacementKey>
\t<SaveDataPerCompany>No</SaveDataPerCompany>
\t<DeleteActions />
${FIELD_GROUPS_XML}
\t<Fields>
${fieldsXml}
\t</Fields>
\t<FullTextIndexes />
${buildIndexesXml(keyFields)}
\t<Mappings />
${buildRelationsXml(names.entityName, keyFields)}
\t<StateMachines />
</AxTable>
`;
}
