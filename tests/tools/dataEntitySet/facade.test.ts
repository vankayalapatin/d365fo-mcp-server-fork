/**
 * d365fo_file set-mode wiring (src/tools/dataEntitySet/facade.ts + the
 * action="create" branch in src/tools/d365foFile.ts).
 *
 * Exercised through the REAL d365foFileTool facade, so the branch itself is
 * under test — not just the adapter. handleCreateD365File is mocked (same
 * approach as orchestrator.test.ts) and bridge.readTable returns the
 * ContosoTestRecord fixture shape (same as resolveInput.test.ts).
 *
 * The third block is the important one: without `sourceTable`, action="create"
 * must reach handleCreateD365File exactly as before. That guards against the
 * new branch leaking into the existing single-file contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('../../../src/tools/createD365File', () => ({
  handleCreateD365File: mockCreate,
}));

vi.mock('../../../src/utils/configManager', () => ({
  getConfigManager: () => ({
    getAutoDetectedModelName: async () => 'Contoso',
  }),
}));

import { d365foFileTool } from '../../../src/tools/d365foFile';
import { recordCreatedArtifact, _clearCreatedArtifactLedger } from '../../../src/tools/createdArtifactLedger';

let tmpDir: string;

/** The fixture source table as the bridge returns it (real wire shape for index fields). */
function contosoTestRecord(overrides: Record<string, any> = {}): any {
  return {
    name: 'ContosoTestRecord',
    label: '@Contoso:ContosoTestRecordTable',
    primaryIndex: 'NameIdx',
    model: 'Contoso',
    fields: [
      { name: 'Name', fieldType: 'String', extendedDataType: 'Name', mandatory: false },
      { name: 'Gender', fieldType: 'String', label: '@Contoso:ContosoTestRecordGender', mandatory: false },
      { name: 'Country', fieldType: 'String', label: '@Contoso:ContosoTestRecordCountry', mandatory: false },
    ],
    indexes: [{
      name: 'NameIdx',
      allowDuplicates: false,
      alternateKey: true,
      fields: [{ dataField: 'Name', includedColumn: false }],
    }],
    relations: [],
    methods: [],
    ...overrides,
  };
}

function makeContext(table: any = contosoTestRecord()) {
  const readTable = vi.fn(async () => table);
  return {
    readTable,
    context: {
      bridge: { isReady: true, metadataAvailable: true, readTable },
      symbolIndex: {
        removeSymbolsByFile: () => ({ deletedCount: 0, objectNames: [] }),
        removeLabelsByFile: () => 0,
      },
    } as any,
  };
}

/** Mock a successful create: write the file and record it, as the real one does. */
function succeedFor(objectName: string) {
  const filePath = path.join(tmpDir, `${objectName}.xml`);
  fs.writeFileSync(filePath, `<Ax><Name>${objectName}</Name></Ax>`, 'utf-8');
  recordCreatedArtifact({ filePath, objectName, objectType: 'stub' });
  return { content: [{ type: 'text', text: `✅ Successfully created\n📁 Path: ${filePath}` }] };
}

function req(args: Record<string, unknown>): any {
  return { method: 'tools/call', params: { name: 'd365fo_file', arguments: args } };
}

beforeEach(() => {
  _clearCreatedArtifactLedger();
  mockCreate.mockReset();
  vi.stubEnv('EXTENSION_PREFIX', '');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'des-facade-'));
});

afterEach(() => {
  _clearCreatedArtifactLedger();
  vi.unstubAllEnvs();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('d365fo_file action="create" + sourceTable — set mode', () => {
  it('creates the four artifacts in dependency order and surfaces resolver warnings', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    const { context } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create',
      objectType: 'data-entity',
      objectName: 'ContosoTestRecordEntity',
      sourceTable: 'ContosoTestRecord',
    }), context);

    expect(result.isError).toBeFalsy();

    expect(mockCreate.mock.calls.map(c => [
      c[0].params.arguments.objectType,
      c[0].params.arguments.objectName,
    ])).toEqual([
      ['data-entity', 'ContosoTestRecordEntity'],
      ['table', 'ContosoTestRecordStaging'],
      ['security-privilege', 'ContosoTestRecordEntityView'],
      ['security-privilege', 'ContosoTestRecordEntityMaintain'],
    ]);

    // The resolver's title-field warning is folded in ABOVE the orchestrator summary.
    const text = result.content[0].text;
    expect(text).toMatch(/TitleField1\/TitleField2 are not returned by the metadata bridge/);
    expect(text).toMatch(/Data entity set created/);
    expect(text.indexOf('TitleField1')).toBeLessThan(text.indexOf('Data entity set created'));
  });

  it('accepts entityName explicitly and honours keyFields / title-field overrides', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    const { context } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create',
      entityName: 'ContosoTestRecordEntity',
      sourceTable: 'ContosoTestRecord',
      titleField1: 'Name',
      titleField2: 'Gender',
      keyFields: ['Name'],
    }), context);

    expect(result.isError).toBeFalsy();
    // Explicit title fields ⇒ no title-field warning.
    expect(result.content[0].text).not.toMatch(/TitleField1\/TitleField2 are not returned/);
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });

  it('accepts comma-separated keyFields as agents often send them', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    const { context } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create',
      objectName: 'ContosoTestRecordEntity',
      sourceTable: 'ContosoTestRecord',
      keyFields: 'Name',
    }), context);

    expect(result.isError).toBeFalsy();
    const entityXml = mockCreate.mock.calls[0][0].params.arguments.xmlContent as string;
    expect(entityXml).toContain('<DataField>Name</DataField>');
  });

  it('reaches set mode when sourceTable arrives nested in params', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    const { context } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create',
      params: { objectName: 'ContosoTestRecordEntity', sourceTable: 'ContosoTestRecord' },
    }), context);

    expect(result.isError).toBeFalsy();
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });
});

describe('d365fo_file set mode — failures never throw', () => {
  it('surfaces a resolver failure as isError with no creates attempted', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    const { context } = makeContext(null); // readTable → table not found

    const result = await d365foFileTool(req({
      action: 'create',
      objectName: 'ContosoTestRecordEntity',
      sourceTable: 'NoSuchTable',
    }), context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/could not resolve the source table/);
    expect(result.content[0].text).toMatch(/was not found/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('surfaces an unavailable bridge as isError, not an exception', async () => {
    const result = await d365foFileTool(req({
      action: 'create',
      objectName: 'ContosoTestRecordEntity',
      sourceTable: 'ContosoTestRecord',
    }), { bridge: undefined } as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/metadata bridge is unavailable/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // A reserved field named as the key is rejected on BOTH routes below, but by
  // two different guards — worth pinning separately so neither regresses.
  it('rejects a reserved key that IS a source field via the orchestrator guard', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    // Source table surfaces DataAreaId as a real field, so it reaches
    // businessFields, gets dropped by filterReservedFields, and the orchestrator's
    // dedicated "key can't be a system field" guard fires.
    const { context } = makeContext(contosoTestRecord({
      fields: [
        { name: 'DataAreaId', fieldType: 'String', mandatory: false },
        { name: 'Name', fieldType: 'String', extendedDataType: 'Name', mandatory: false },
      ],
    }));

    const result = await d365foFileTool(req({
      action: 'create',
      objectName: 'ContosoTestRecordEntity',
      sourceTable: 'ContosoTestRecord',
      keyFields: ['DataAreaId'],
    }), context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/invalid input/i);
    expect(result.content[0].text).toMatch(/reserved system field/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a reserved key that is NOT a source field via assembly validation', async () => {
    mockCreate.mockImplementation(async (r: any) => succeedFor(r.params.arguments.objectName));
    // DataAreaId is absent from the table's fields, so filterReservedFields drops
    // nothing and the orchestrator's reserved-key guard cannot fire. Assembly's
    // "key field must name a selected business field" check catches it instead —
    // a less specific message, but still isError with nothing written.
    const { context } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create',
      objectName: 'ContosoTestRecordEntity',
      sourceTable: 'ContosoTestRecord',
      keyFields: ['DataAreaId'],
    }), context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not among the selected business fields/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('errors clearly when the entity name is missing entirely', async () => {
    const { context } = makeContext();
    const result = await d365foFileTool(req({
      action: 'create',
      sourceTable: 'ContosoTestRecord',
    }), context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/entity name is required/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('d365fo_file action="create" WITHOUT sourceTable — unchanged single-file path', () => {
  it('calls handleCreateD365File exactly once, with the args untouched', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '✅ created' }] });
    const { context, readTable } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create',
      objectType: 'class',
      objectName: 'ConMyClass',
      sourceCode: 'public class ConMyClass {}',
    }), context);

    expect(result.isError).toBeFalsy();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].params.arguments).toEqual({
      objectType: 'class',
      objectName: 'ConMyClass',
      sourceCode: 'public class ConMyClass {}',
    });
    // Set mode never engaged — the source table was never read.
    expect(readTable).not.toHaveBeenCalled();
  });

  it('does not engage set mode for a blank sourceTable', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '✅ created' }] });
    const { context } = makeContext();

    await d365foFileTool(req({
      action: 'create',
      objectType: 'class',
      objectName: 'ConMyClass',
      sourceTable: '   ',
    }), context);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('passes a create error through unchanged', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '❌ boom' }], isError: true });
    const { context } = makeContext();

    const result = await d365foFileTool(req({
      action: 'create', objectType: 'class', objectName: 'ConMyClass',
    }), context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('❌ boom');
  });
});
