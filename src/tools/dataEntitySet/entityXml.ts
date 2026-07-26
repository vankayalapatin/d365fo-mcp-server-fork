/**
 * Data entity set — AxDataEntityView builder.
 *
 * Ground truth: docs/data-entity-set-findings.md §1 and §3, captured from the
 * real VS Data Entity Wizard. Verified against
 * tests/fixtures/data-entity/ContosoTestRecordEntity.xml byte-for-byte
 * (tests/tools/dataEntitySet/entityXml.test.ts).
 *
 * This is a NEW builder, independent of ../dataEntityXml.ts (the existing
 * create_d365fo_file(objectType="data-entity") path). That builder predates
 * the wizard capture and gets several things wrong that this one corrects:
 *   - it omits SubscriberAccessLevel, PrimaryCompanyContext,
 *     SupportsSetBasedSqlOperations, DeleteActions, FieldGroups, and
 *     StateMachines entirely
 *   - its PublicCollectionName default (`${entityName}Collection`) and
 *     PublicEntityName default (`${entityName}`) both diverge from the
 *     wizard, which uses the SAME value for both — the un-prefixed,
 *     Entity-suffix-stripped table base (see ./names.ts)
 *   - its ViewMetadata query datasource lists explicit AxQuerySimpleDataSourceField
 *     entries; the wizard leaves <Fields /> empty and relies on
 *     <DynamicFields>Yes</DynamicFields> instead
 * Reconciling the two builders is future work, not part of this narrow pass —
 * see ../dataEntityXml.ts for the current create-path builder.
 *
 * Golden rule (findings §1): generated XML contains only non-default values.
 * Every element below is present in the fixture — nothing here is emitted
 * speculatively. DataManagementEnabled=Yes, IsPublic=Yes,
 * PrimaryCompanyContext=DataAreaId, and SupportsSetBasedSqlOperations=Yes
 * reflect the ONE verified wizard-options configuration (findings intro:
 * "Enable public API" on, "Enable data management" on, entity category
 * Master, company-specific source table). None of these are parameterized
 * here — doing so without a second fixture (a non-company-specific source
 * table, data management disabled, etc. — findings §9) would be guessing at
 * shapes nobody has verified. Composite entity keys ARE supported (`keyFields`
 * is an array) since that's not a wizard-OPTION variation but the ordinary
 * shape of the Keys element even in the single-key fixture case.
 *
 * Element order is fixed and reproduced exactly (findings §3):
 *   Name, SourceCode, Label, SubscriberAccessLevel, DataManagementEnabled,
 *   DataManagementStagingTable, IsPublic, PrimaryCompanyContext, PrimaryKey,
 *   PublicCollectionName, PublicEntityName, SupportsSetBasedSqlOperations,
 *   DeleteActions, FieldGroups, Fields, Keys, Mappings, Ranges, Relations,
 *   StateMachines, ViewMetadata.
 */

import type { DataEntitySetNames } from './names.js';

export interface DataEntityFieldSpec {
  /** AxDataEntityViewField Name — also the default DataField when dataField is omitted. */
  name: string;
  /** Underlying source-table field name, when it differs from `name`. */
  dataField?: string;
}

export interface DataEntitySetEntityInput {
  /** Names derived by deriveDataEntitySetNames — the single naming source of truth. */
  names: DataEntitySetNames;
  /** Source table AOT name — used as DataSource on every field and as the ViewMetadata query root. */
  primaryTable: string;
  /** Entity Label, copied verbatim from the source table's label (findings §3). */
  label: string;
  /** Selected fields, in wizard-grid order. */
  fields: DataEntityFieldSpec[];
  /** Field `name`s forming the entity key — derived from the source table's primary index. One or more. */
  keyFields: string[];
}

/**
 * Five auto field groups the wizard always emits, unconditionally, with empty
 * `<Fields />` on the entity — constant across every captured entity so far.
 */
const FIELD_GROUPS_XML = `\t<FieldGroups>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoReport</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoLookup</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoIdentification</Name>
\t\t\t<AutoPopulate>Yes</AutoPopulate>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoSummary</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoBrowse</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t</FieldGroups>`;

function buildSourceCodeXml(entityName: string): string {
  return `\t<SourceCode>
\t\t<Declaration><![CDATA[
public class ${entityName} extends common
{
}
]]></Declaration>
\t\t<Methods />
\t</SourceCode>`;
}

/**
 * Mandatory is emitted only on key fields (findings §3) — never on the others,
 * per the golden rule.
 */
function buildFieldXml(field: DataEntityFieldSpec, primaryTable: string, isKeyField: boolean): string {
  const dataField = field.dataField ?? field.name;
  const mandatoryLine = isKeyField ? `\n\t\t\t<Mandatory>Yes</Mandatory>` : '';
  return `\t\t<AxDataEntityViewField xmlns=""
\t\t\ti:type="AxDataEntityViewMappedField">
\t\t\t<Name>${field.name}</Name>${mandatoryLine}
\t\t\t<DataField>${dataField}</DataField>
\t\t\t<DataSource>${primaryTable}</DataSource>
\t\t</AxDataEntityViewField>`;
}

function buildKeyFieldXml(fieldName: string): string {
  return `\t\t\t\t<AxDataEntityViewKeyField>
\t\t\t\t\t<DataField>${fieldName}</DataField>
\t\t\t\t</AxDataEntityViewKeyField>`;
}

/**
 * The wizard's query datasource leaves <Fields /> EMPTY and relies on
 * <DynamicFields>Yes</DynamicFields> instead of listing query fields
 * explicitly (findings §3, ViewMetadata) — this is NOT a bug, it's what
 * distinguishes this builder from ../dataEntityXml.ts's older assumption.
 */
function buildViewMetadataXml(primaryTable: string): string {
  return `\t<ViewMetadata>
\t\t<Name>Metadata</Name>
\t\t<SourceCode>
\t\t\t<Methods>
\t\t\t\t<Method>
\t\t\t\t\t<Name>classDeclaration</Name>
\t\t\t\t\t<Source><![CDATA[
[Query]
public class Metadata extends QueryRun
{
}
]]></Source>
\t\t\t\t</Method>
\t\t\t</Methods>
\t\t</SourceCode>
\t\t<DataSources>
\t\t\t<AxQuerySimpleRootDataSource>
\t\t\t\t<Name>${primaryTable}</Name>
\t\t\t\t<DynamicFields>Yes</DynamicFields>
\t\t\t\t<Table>${primaryTable}</Table>
\t\t\t\t<DataSources />
\t\t\t\t<DerivedDataSources />
\t\t\t\t<Fields />
\t\t\t\t<Ranges />
\t\t\t\t<GroupBy />
\t\t\t\t<Having />
\t\t\t\t<OrderBy />
\t\t\t</AxQuerySimpleRootDataSource>
\t\t</DataSources>
\t</ViewMetadata>`;
}

export function buildDataEntitySetEntityXml(input: DataEntitySetEntityInput): string {
  const { names, primaryTable, label, fields, keyFields } = input;

  if (fields.length === 0) {
    throw new Error('buildDataEntitySetEntityXml: at least one field is required');
  }
  if (keyFields.length === 0) {
    throw new Error('buildDataEntitySetEntityXml: at least one key field is required');
  }

  const keyFieldSet = new Set(keyFields);
  const fieldsXml = fields
    .map(f => buildFieldXml(f, primaryTable, keyFieldSet.has(f.name)))
    .join('\n');
  const keyFieldsXml = keyFields.map(buildKeyFieldXml).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<AxDataEntityView xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${names.entityName}</Name>
${buildSourceCodeXml(names.entityName)}
\t<Label>${label}</Label>
\t<SubscriberAccessLevel>
\t\t<Read>Allow</Read>
\t</SubscriberAccessLevel>
\t<DataManagementEnabled>Yes</DataManagementEnabled>
\t<DataManagementStagingTable>${names.stagingTableName}</DataManagementStagingTable>
\t<IsPublic>Yes</IsPublic>
\t<PrimaryCompanyContext>DataAreaId</PrimaryCompanyContext>
\t<PrimaryKey>EntityKey</PrimaryKey>
\t<PublicCollectionName>${names.publicCollectionName}</PublicCollectionName>
\t<PublicEntityName>${names.publicEntityName}</PublicEntityName>
\t<SupportsSetBasedSqlOperations>Yes</SupportsSetBasedSqlOperations>
\t<DeleteActions />
${FIELD_GROUPS_XML}
\t<Fields>
${fieldsXml}
\t</Fields>
\t<Keys>
\t\t<AxDataEntityViewKey>
\t\t\t<Name>EntityKey</Name>
\t\t\t<Fields>
${keyFieldsXml}
\t\t\t</Fields>
\t\t</AxDataEntityViewKey>
\t</Keys>
\t<Mappings />
\t<Ranges />
\t<Relations />
\t<StateMachines />
${buildViewMetadataXml(primaryTable)}
</AxDataEntityView>
`;
}
