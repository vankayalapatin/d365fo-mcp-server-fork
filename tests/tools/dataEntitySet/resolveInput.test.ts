/**
 * resolveDataEntitySetInput (src/tools/dataEntitySet/resolveInput.ts) — Layer 3.
 *
 * The acceptance criterion is composition: given only an entity name and a
 * source table name, the resolver must produce EXACTLY the BASE_INPUT constant
 * that orchestrator.test.ts feeds into createDataEntitySet (./sharedInput.ts).
 * If either side drifts, one of the two suites breaks.
 *
 * bridge.readTable is mocked with the real ContosoTestRecord fixture shape
 * (tests/fixtures/data-entity/ContosoTestRecord.xml). ConfigManager is mocked so
 * the active model — and therefore the model prefix — is deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/utils/configManager', () => ({
  getConfigManager: () => ({
    getAutoDetectedModelName: async () => 'Contoso',
  }),
}));

import {
  resolveDataEntitySetInput,
  DataEntitySetResolveError,
} from '../../../src/tools/dataEntitySet/resolveInput';
import { BASE_INPUT } from './sharedInput';

/**
 * The fixture source table as the bridge returns it.
 *
 * Index fields deliberately use the REAL wire shape — `[{ dataField, ... }]` —
 * not the `string[]` that BridgeIndexInfo declares, because the C# side sends
 * IndexFieldModel objects (Models.cs). Proving the resolver handles this is the
 * point; a naive implementation would produce `[undefined]` for keyFields.
 */
function contosoTestRecord(overrides: Record<string, any> = {}): any {
  return {
    name: 'ContosoTestRecord',
    label: '@Contoso:ContosoTestRecordTable',
    primaryIndex: 'NameIdx',
    model: 'Contoso',
    tableGroup: 'Main',
    fields: [
      { name: 'Name', fieldType: 'String', extendedDataType: 'Name', mandatory: false },
      { name: 'Gender', fieldType: 'String', label: '@Contoso:ContosoTestRecordGender', mandatory: false },
      { name: 'Country', fieldType: 'String', label: '@Contoso:ContosoTestRecordCountry', mandatory: false },
    ],
    indexes: [
      {
        name: 'NameIdx',
        allowDuplicates: false,
        alternateKey: true,
        fields: [{ dataField: 'Name', includedColumn: false }],
      },
    ],
    relations: [],
    methods: [],
    ...overrides,
  };
}

function makeContext(table: any) {
  const readTable = vi.fn(async () => table);
  return {
    readTable,
    context: {
      bridge: { isReady: true, metadataAvailable: true, readTable },
    } as any,
  };
}

beforeEach(() => {
  // Guarantee the prefix comes from the model name, not a stray env override.
  vi.stubEnv('EXTENSION_PREFIX', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveDataEntitySetInput — composes with the orchestrator', () => {
  it('produces exactly the BASE_INPUT the orchestrator tests consume', async () => {
    const { context } = makeContext(contosoTestRecord());

    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );

    expect(input).toEqual(BASE_INPUT);
  });

  it('reads the source table exactly once, by name', async () => {
    const { context, readTable } = makeContext(contosoTestRecord());

    await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );

    expect(readTable).toHaveBeenCalledTimes(1);
    expect(readTable).toHaveBeenCalledWith('ContosoTestRecord');
  });
});

describe('resolveDataEntitySetInput — field and key mapping', () => {
  it('normalizes index fields sent as {dataField} objects (the real wire shape)', async () => {
    const { context } = makeContext(contosoTestRecord());
    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.keyFields).toEqual(['Name']);
  });

  it('also accepts index fields sent as plain strings (the declared type)', async () => {
    const table = contosoTestRecord({
      indexes: [{ name: 'NameIdx', allowDuplicates: false, fields: ['Name'] }],
    });
    const { context } = makeContext(table);

    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.keyFields).toEqual(['Name']);
  });

  it('excludes included columns from the entity key', async () => {
    const table = contosoTestRecord({
      indexes: [{
        name: 'NameIdx',
        allowDuplicates: false,
        fields: [
          { dataField: 'Name', includedColumn: false },
          { dataField: 'Country', includedColumn: true },
        ],
      }],
    });
    const { context } = makeContext(table);

    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.keyFields).toEqual(['Name']);
  });

  it('carries enum fields through with their EnumType', async () => {
    const table = contosoTestRecord({
      fields: [
        { name: 'Name', fieldType: 'String', extendedDataType: 'Name', mandatory: false },
        { name: 'Status', fieldType: 'Enum', enumType: 'NoYes', mandatory: false },
      ],
    });
    const { context } = makeContext(table);

    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.businessFields[1]).toEqual({ name: 'Status', enumType: 'NoYes' });
  });

  it('honours an explicit keyFields override instead of the primary index', async () => {
    const { context } = makeContext(contosoTestRecord());
    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord', keyFields: ['Country'] },
      context,
    );
    expect(input.keyFields).toEqual(['Country']);
  });
});

describe('resolveDataEntitySetInput — title fields (bridge cannot supply them)', () => {
  it('falls back to the first two fields AND warns, never silently', async () => {
    const { context } = makeContext(contosoTestRecord());

    const { input, warnings } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );

    expect(input.titleField1).toBe('Name');
    expect(input.titleField2).toBe('Gender');
    expect(warnings.some(w => /TitleField1\/TitleField2 are not returned by the metadata bridge/.test(w))).toBe(true);
  });

  it('uses explicit title fields and emits no title warning', async () => {
    const { context } = makeContext(contosoTestRecord());

    const { input, warnings } = await resolveDataEntitySetInput(
      {
        entityName: 'ContosoTestRecordEntity',
        sourceTable: 'ContosoTestRecord',
        titleField1: 'Country',
        titleField2: 'Name',
      },
      context,
    );

    expect(input.titleField1).toBe('Country');
    expect(input.titleField2).toBe('Name');
    expect(warnings.some(w => /TitleField/.test(w))).toBe(false);
  });
});

describe('resolveDataEntitySetInput — model prefix', () => {
  it('resolves the prefix from the active model without asking the caller', async () => {
    const { context } = makeContext(contosoTestRecord());
    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.modelPrefix).toBe('Contoso');
  });

  it('never re-adds the prefix to the entity name (the double-prefix trap)', async () => {
    const { context } = makeContext(contosoTestRecord());
    const { input } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.entityName).toBe('ContosoTestRecordEntity');
    expect(input.entityName).not.toContain('ContosoContoso');
  });

  it('warns when the entity name does not carry the resolved prefix', async () => {
    const { context } = makeContext(contosoTestRecord());
    const { warnings } = await resolveDataEntitySetInput(
      { entityName: 'OtherTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(warnings.some(w => /does not start with the resolved model prefix/.test(w))).toBe(true);
  });

  it('prefers an explicitly supplied modelName over the active model', async () => {
    const { context } = makeContext(contosoTestRecord());
    const { input } = await resolveDataEntitySetInput(
      { entityName: 'FabrikamThingEntity', sourceTable: 'ContosoTestRecord', modelName: 'Fabrikam' },
      context,
    );
    expect(input.modelPrefix).toBe('Fabrikam');
    expect(input.modelName).toBe('Fabrikam');
  });
});

describe('resolveDataEntitySetInput — failure modes', () => {
  it('throws when the bridge is unavailable', async () => {
    await expect(resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      { bridge: undefined } as any,
    )).rejects.toThrow(/metadata bridge is unavailable/);
  });

  it('throws when the source table is not found', async () => {
    const { context } = makeContext(null);
    await expect(resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'NoSuchTable' },
      context,
    )).rejects.toBeInstanceOf(DataEntitySetResolveError);
  });

  it('throws when the source table has no fields', async () => {
    const { context } = makeContext(contosoTestRecord({ fields: [] }));
    await expect(resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    )).rejects.toThrow(/has no fields/);
  });

  it('throws when the source table has no primary index and no override', async () => {
    const { context } = makeContext(contosoTestRecord({ primaryIndex: undefined }));
    await expect(resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    )).rejects.toThrow(/no PrimaryIndex/);
  });

  it('throws when the named primary index is missing from the payload', async () => {
    const { context } = makeContext(contosoTestRecord({ indexes: [] }));
    await expect(resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    )).rejects.toThrow(/was not returned with the table/);
  });

  it('warns (but does not throw) when the source table has no label', async () => {
    const { context } = makeContext(contosoTestRecord({ label: undefined }));
    const { input, warnings } = await resolveDataEntitySetInput(
      { entityName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
      context,
    );
    expect(input.label).toBe('');
    expect(warnings.some(w => /has no Label/.test(w))).toBe(true);
  });
});
