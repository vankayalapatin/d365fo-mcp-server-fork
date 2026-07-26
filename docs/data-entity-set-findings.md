# Data entity set — verified wizard behaviour

Ground truth captured from the VS Data Entity Wizard on a D365 FO UDE machine.

Source table: `ContosoTestRecord` (model prefix `Contoso`, fields `Name`/`Gender`/
`Country`, primary index `NameIdx` on `Name`, company-specific i.e.
`SaveDataPerCompany` defaulted).

Wizard options used: Enable public API = on, Enable data management capabilities = on,
Entity category = Master, all business fields selected, `DataAreaId` NOT selected.

Everything below is observed from generated XML and the wizard UI, not inferred.

---

## 1. The golden rule

**Generated XML contains only non-default values.**

The VS properties grid shows *effective* values (defaults included). The `.xml` file on
disk contains only *overrides*. Examples from the captured staging table:

| Property | Properties grid | In the XML? |
|---|---|---|
| Table Type | Regular | absent (Regular is default) |
| Cache Lookup | None | absent (None is default) |
| Clustered Index | SurrogateKey | absent |
| Create Rec Id Index | Yes | absent |
| Visible | Yes | absent |
| Occ Enabled | Yes | absent |
| Table Group | Staging | **present** (non-default) |
| Save Data Per Company | No | **present** (non-default) |

Implication for the generator: do not emit properties just because they're known.
Emitting explicit defaults produces XML that compiles but diverges from what VS writes,
which makes fixtures and diffs useless.

This also resolves the TempDB question: staging is a **Regular** table. The absence of a
`TableType` element is the proof. Any part of the codebase asserting TempDB is wrong and
should be corrected as part of this work.

---

## 2. Naming rules — driven by the entity name, not the source table

**Confirmed by watching the wizard directly:** the "Primary datasource" (source table)
dropdown was still empty when the staging table name, public entity name, public
collection name, and both privilege names had already auto-populated. Since the wizard
had not yet been told which table to use, those names cannot be derived from the table.
They are derived from the **entity name**.

The rule: take the entity name, strip the model prefix, and strip a trailing `Entity` if
present, to get the base name.

| Artifact | Rule | Example (entity name `ContosoTestRecordEntity`) |
|---|---|---|
| Entity | user-supplied | `ContosoTestRecordEntity` |
| Staging table | `{base}Staging` | `ContosoTestRecordStaging` |
| View privilege | `{entity}View` | `ContosoTestRecordEntityView` |
| Maintain privilege | `{entity}Maintain` | `ContosoTestRecordEntityMaintain` |
| Public entity name | `{base}` (prefix stripped) | `TestRecord` |
| Public collection name | identical to public entity name | `TestRecord` |

Notes:
- In the captured test case, table-driven and entity-driven derivation happen to agree,
  because the table and entity names lined up. That coincidence is why an earlier version
  of this doc wrongly concluded the naming was table-driven — the blank dropdown is the
  only real evidence, and it points to entity-driven.
- Public entity and collection names are **the same value**. Neither `${name}Collection`
  nor `${name}s` matches.
- The model prefix is stripped from public names only, not from object names.
- **Input model:** the tool needs both an entity name (drives all naming) and a source
  table (supplies field list, primary index, label, and company-scoping info) — neither
  should be derived from the other.
- **Double-prefix trap:** if the underlying create pathway automatically prepends a model
  prefix, and the supplied entity name already carries that prefix, names derived from it
  must bypass that automatic prefixing — or you get a doubled prefix
  (e.g. `ContosoContosoTestRecordEntity`).

---

## 3. Entity — `AxDataEntityView`

### Element order (fixed; serializer is order-sensitive)

```
Name
SourceCode            (Declaration CDATA + empty Methods)
Label
SubscriberAccessLevel (Read: Allow)
DataManagementEnabled
DataManagementStagingTable
IsPublic
PrimaryCompanyContext
PrimaryKey
PublicCollectionName
PublicEntityName
SupportsSetBasedSqlOperations
DeleteActions         (empty)
FieldGroups           (5 auto groups, all empty)
Fields
Keys
Mappings              (empty)
Ranges                (empty)
Relations             (empty)
StateMachines         (empty)
ViewMetadata
```

### Values

- `Label` — copied from the source table's label
- `SubscriberAccessLevel` — `<Read>Allow</Read>`
- `DataManagementEnabled` — `Yes`
- `DataManagementStagingTable` — the staging table name (see §2)
- `IsPublic` — `Yes` (driven by "Enable public API")
- `PrimaryCompanyContext` — `DataAreaId` (because the source table is company-specific).
  This is a **property**, never a field — see §6.
- `PrimaryKey` — `EntityKey` — confirms existing element name is correct
- `SupportsSetBasedSqlOperations` — `Yes`
- `EnableSetBasedSqlOperations` — absent (Auto is default)

### Declaration

```
public class {EntityName} extends common
{
}
```

### FieldGroups

Five groups, all with empty `<Fields />`: `AutoReport`, `AutoLookup`,
`AutoIdentification` (with `<AutoPopulate>Yes</AutoPopulate>`), `AutoSummary`, `AutoBrowse`.

### Fields

One `AxDataEntityViewField` with `i:type="AxDataEntityViewMappedField"` per selected
field, in wizard-grid order. Each carries `Name`, `DataField`, `DataSource` (= source
table name). `Mandatory` is emitted only on the key field.

### Keys

```
Keys > AxDataEntityViewKey > Name = EntityKey
                          > Fields > AxDataEntityViewKeyField > DataField
```

Key fields derive from the **source table's primary index**.

### ViewMetadata

```
Name = Metadata
classDeclaration = [Query] public class Metadata extends QueryRun { }
DataSources > AxQuerySimpleRootDataSource
  Name  = source table name
  DynamicFields = Yes
  Table = source table name
  + empty DataSources, DerivedDataSources, Fields, Ranges, GroupBy, Having, OrderBy
```

### Mappings / Relations — empty, and correct as-is

Both stay empty. DMF maps entity fields to staging fields at runtime, via "Modify target
mapping" in the Data Management workspace — not via this file. **No generator work
needed here.**

---

## 4. Staging table — `AxTable`

### Element order

```
Name
SourceCode              (empty Methods only, no Declaration)
DeveloperDocumentation  @DMF:StagingDeveloperDocumentation
Label
TableGroup              Staging
TitleField1 / TitleField2
PrimaryIndex            StagingIdx
ReplacementKey          StagingIdx
SaveDataPerCompany      No
DeleteActions           (empty)
FieldGroups
Fields
FullTextIndexes         (empty)
Indexes
Mappings                (empty)
Relations               <-- NOT empty
StateMachines           (empty)
```

### Properties

- `DeveloperDocumentation` — fixed constant `@DMF:StagingDeveloperDocumentation`
- `Label`, `TitleField1`, `TitleField2` — copied from the source table
- `TableGroup` — `Staging`
- `PrimaryIndex` and `ReplacementKey` — both `StagingIdx`
- `SaveDataPerCompany` — `No` (staging is cross-company; company context lives on the
  entity, not the staging table)
- No `TableType`, no `CacheLookup` — see the golden rule (§1)

### Fields — DMF fields first, then business fields

All fields, including business ones, carry `<IsSystemGenerated>Yes</IsSystemGenerated>`.

The four DMF fields, in this order:

| Name | i:type | EDT / EnumType | Other |
|---|---|---|---|
| `DefinitionGroup` | `AxTableFieldString` | EDT `DMFDefinitionGroupName` | `AllowEdit=No`, `Mandatory=Yes`, `StringSize=60` |
| `ExecutionId` | `AxTableFieldString` | EDT `DMFExecutionId` | `AllowEdit=No`, `Mandatory=Yes`, `StringSize=90` |
| `IsSelected` | `AxTableFieldEnum` | EDT `DMFIsSelected`, EnumType `NoYes` | |
| `TransferStatus` | `AxTableFieldEnum` | EnumType `DMFTransferStatus` | no EDT |

Then the business fields, mirroring the source table's `ExtendedDataType` and `Label`
exactly (no type coercion to string). `Mandatory=Yes` is added on the key field.

### FieldGroups

Same five auto groups as the source table but with **empty** `<Fields />`, each with
`<IsSystemGenerated>Yes</IsSystemGenerated>`, plus a sixth:

```
ExtensionList
  IsSystemGenerated = Yes
  Label = @DMF:StagingExtensionGroup
  Fields: DefinitionGroup, IsSelected, TransferStatus, ExecutionId
```

Note the group's field order differs from the `Fields` node order.

### Indexes

```
StagingIdx
  AlternateKey = Yes
  IsSystemGenerated = Yes
  Fields: DefinitionGroup, ExecutionId, <entity key field(s)>
```

The third component is derived, not fixed.

### Relations — required, not to be skipped

```
AxTableRelation  i:type="AxTableRelationForeignKey"
  Name                    = DataEntity
  Cardinality             = ExactlyOne
  EntityRelationshipRole  = @DMF:StagingToDataEntityRelationshipRole
  IsSystemGenerated       = Yes
  RelatedTable            = <entity name>
  RelatedTableCardinality = ZeroOne
  RelationshipType        = Link
  Validate                = No
  Constraints > AxTableRelationConstraint i:type="AxTableRelationConstraintField"
    Name / Field / RelatedField = <key field name>
```

One constraint per entity key field. Nothing in the existing codebase emits this shape
today — this needs a new builder.

---

## 5. Privileges — `AxSecurityPrivilege`

### Element order

```
Name
DataEntityPermissions
  AxSecurityDataEntityPermission
    Grant        <-- before Name
    Name         = entity name
    Fields       (empty)
    Methods      (empty)
DirectAccessPermissions (empty)
EntryPoints             (empty)
FormControlOverrides    (empty)
```

The Grant-before-Name inversion must be preserved.

### Grants

- **View**: `Read` only
- **Maintain**: `Correct`, `Create`, `Delete`, `Read`, `Update` — all `Allow`, alphabetical

No `IntegrationMode` element is emitted. No duty and no role are generated — the
privileges are left unattached.

---

## 6. `DataAreaId` is a trap — filter it out entirely

`DataAreaId` appears in the wizard's field-selection grid, unchecked by default.
Checking it produces XML that fails to build:

```
Invalid field name; 'DataAreaId' is reserved for system fields.
```

...on both the entity and the staging table. Company context is expressed by the
entity's `PrimaryCompanyContext` property instead — never as a field.

**Improvement over the wizard:** the tool should filter system fields (`DataAreaId`,
`RecId`, `RecVersion`, `Partition`, `CreatedBy`, `CreatedDateTime`, `ModifiedBy`,
`ModifiedDateTime`, ...) out of the selectable field list entirely, so an uncompilable
set cannot be generated in the first place.

---

## 7. Build approach: generate all four files directly

An existing table-creation code path elsewhere in the project looked like a shortcut for
the staging table, but it doesn't fit:

- It always writes properties (e.g. cache lookup) that the wizard leaves as defaults —
  breaking the golden rule in §1.
- It cannot express several things the staging table needs: which fields are
  system-generated, which fields aren't editable, and the full relationship shape in §4
  (cardinality, relationship type, the type discriminator, constraint names).

**Decision: all four files are generated directly, not through that shortcut.** This is
the only approach that can hit a byte-for-byte match against captured reference files,
and it avoids needing anything that only runs on a machine with D365 FO installed.

---

## 8. Open items

- **Two cosmetic table properties** (`TitleField1`/`TitleField2`) are copied from the
  source table in the wizard's output, but the tool doesn't currently have a way to read
  them from an existing table. Two options: read the source table's file directly, or
  omit them for now and accept a small, documented divergence from wizard output in the
  fixture comparison. Doesn't block anything else.
- **Fixtures come first.** Save the four reference files captured from the real wizard
  as test fixtures before writing any generator code, since every generator should be
  built and checked against them from the start. Use only self-created scratch objects
  as fixtures — never vendor real product metadata into the repo.

---

## 9. Still to verify — lower priority, variants not blockers

Each of these changes the expected output, so worth capturing later with the same
capture-and-compare method used above:

- A source table that is **not** company-specific — does `PrimaryCompanyContext`
  disappear?
- A **composite primary key** source table — how do the key field, `StagingIdx`, and the
  staging relation constraints handle multiple fields?
- Generating with **data management turned off** — which of the four files get skipped?
- Selecting a **subset of fields** rather than all of them.
