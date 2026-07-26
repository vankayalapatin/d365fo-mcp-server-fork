/**
 * createDataEntitySet + filterReservedFields (src/tools/dataEntitySet/orchestrator.ts).
 *
 * handleCreateD365File is MOCKED — no real PackagesLocalDirectory, no C# bridge.
 * The mock simulates exactly the two observable effects the real create has that
 * the orchestrator depends on: it writes a file, and it records that file in the
 * session ledger (createdArtifactLedger).
 *
 * Rollback is deliberately NOT mocked. rollbackCreatedArtifact runs for real
 * against files in a temp directory, so these tests exercise the actual delete +
 * forget + index-cleanup path rather than a stand-in for it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Must be declared before vi.mock's factory runs (hoisted).
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('../../../src/tools/createD365File', () => ({
  handleCreateD365File: mockCreate,
}));

import {
  createDataEntitySet,
  filterReservedFields,
  DataEntitySetInputError,
  RESERVED_FIELD_NAMES,
} from '../../../src/tools/dataEntitySet/orchestrator';
import {
  recordCreatedArtifact,
  listCreatedArtifacts,
  _clearCreatedArtifactLedger,
} from '../../../src/tools/createdArtifactLedger';
// Shared with resolveInput.test.ts — the seam that proves Layer 3 composes
// with Layer 2. See sharedInput.ts.
import { BASE_INPUT } from './sharedInput';

let tmpDir: string;

/** Fake server context: records index-cleanup calls, no bridge. */
function makeContext() {
  const cleaned: string[] = [];
  return {
    cleaned,
    context: {
      symbolIndex: {
        removeSymbolsByFile(filePath: string) {
          cleaned.push(filePath);
          return { deletedCount: 1, objectNames: [] };
        },
        removeLabelsByFile() { return 0; },
      },
    } as any,
  };
}

/**
 * Make the mock behave like a successful create: write the file and record it
 * in the ledger, exactly as handleCreateD365File does on its success path.
 */
function succeedFor(objectName: string) {
  const filePath = path.join(tmpDir, `${objectName}.xml`);
  fs.writeFileSync(filePath, `<Ax><Name>${objectName}</Name></Ax>`, 'utf-8');
  recordCreatedArtifact({ filePath, objectName, objectType: 'stub' });
  return { content: [{ type: 'text', text: `✅ Successfully created\n📁 Path: ${filePath}` }] };
}

beforeEach(() => {
  _clearCreatedArtifactLedger();
  mockCreate.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'des-orch-'));
});

afterEach(() => {
  _clearCreatedArtifactLedger();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('filterReservedFields', () => {
  it('drops every reserved system field', () => {
    const { kept, dropped } = filterReservedFields([
      { name: 'Name' },
      { name: 'DataAreaId' },
      { name: 'RecId' },
      { name: 'RecVersion' },
      { name: 'Partition' },
      { name: 'Country' },
    ]);

    expect(kept.map(f => f.name)).toEqual(['Name', 'Country']);
    expect(dropped).toEqual(['DataAreaId', 'RecId', 'RecVersion', 'Partition']);
  });

  it('matches case-insensitively', () => {
    const { kept, dropped } = filterReservedFields([
      { name: 'dataareaid' },
      { name: 'RECID' },
      { name: 'Name' },
    ]);

    expect(kept.map(f => f.name)).toEqual(['Name']);
    expect(dropped).toEqual(['dataareaid', 'RECID']);
  });

  it('leaves an all-business-field selection untouched', () => {
    const fields = [{ name: 'Name' }, { name: 'Gender' }];
    const { kept, dropped } = filterReservedFields(fields);

    expect(kept).toEqual(fields);
    expect(dropped).toEqual([]);
  });

  it('exports the documented reserved names', () => {
    expect([...RESERVED_FIELD_NAMES]).toEqual(['DataAreaId', 'RecId', 'RecVersion', 'Partition']);
  });
});

describe('createDataEntitySet — reserved-field guard', () => {
  it('drops reserved fields and reports them, without writing them into the set', async () => {
    mockCreate.mockImplementation(async (req: any) => succeedFor(req.params.arguments.objectName));
    const { context } = makeContext();

    const result = await createDataEntitySet(
      { ...BASE_INPUT, businessFields: [...BASE_INPUT.businessFields, { name: 'DataAreaId' }] },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.droppedFields).toEqual(['DataAreaId']);
    expect(result.summary).toMatch(/Reserved system field\(s\) excluded/);

    // DataAreaId must never appear as a FIELD on any artifact...
    for (const call of mockCreate.mock.calls) {
      const xml = call[0].params.arguments.xmlContent as string;
      expect(xml).not.toContain('<Name>DataAreaId</Name>');
      expect(xml).not.toContain('<DataField>DataAreaId</DataField>');
    }

    // ...but it MUST still appear as the entity's PrimaryCompanyContext property.
    // That distinction is the entire point of the guard (findings §6): company
    // context is expressed as a property, and naming it as a field produces XML
    // that fails to build with "'DataAreaId' is reserved for system fields".
    const entityXml = mockCreate.mock.calls[0][0].params.arguments.xmlContent as string;
    expect(entityXml).toContain('<PrimaryCompanyContext>DataAreaId</PrimaryCompanyContext>');
  });

  it('fails BEFORE any write when a key field is a reserved system field', async () => {
    mockCreate.mockImplementation(async (req: any) => succeedFor(req.params.arguments.objectName));
    const { context } = makeContext();

    await expect(createDataEntitySet(
      { ...BASE_INPUT, businessFields: [{ name: 'DataAreaId' }, { name: 'Name' }], keyFields: ['DataAreaId'] },
      context,
    )).rejects.toBeInstanceOf(DataEntitySetInputError);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(listCreatedArtifacts()).toEqual([]);
  });
});

describe('createDataEntitySet — all four writes succeed', () => {
  it('creates the four artifacts in dependency order and reports success', async () => {
    mockCreate.mockImplementation(async (req: any) => succeedFor(req.params.arguments.objectName));
    const { context } = makeContext();

    const result = await createDataEntitySet(BASE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.artifacts.every(a => a.status === 'created')).toBe(true);

    // Entity first — the staging FK and both privileges reference it.
    expect(mockCreate.mock.calls.map(c => [
      c[0].params.arguments.objectType,
      c[0].params.arguments.objectName,
    ])).toEqual([
      ['data-entity', 'ContosoTestRecordEntity'],
      ['table', 'ContosoTestRecordStaging'],
      ['security-privilege', 'ContosoTestRecordEntityView'],
      ['security-privilege', 'ContosoTestRecordEntityMaintain'],
    ]);

    // Every call went through action=create with xmlContent (which is what
    // short-circuits the C# bridge), never through a bridge-backed path.
    for (const call of mockCreate.mock.calls) {
      expect(call[0].params.arguments.action).toBe('create');
      expect(call[0].params.arguments.xmlContent).toContain('<?xml version="1.0" encoding="utf-8"?>');
    }

    // All four files are on disk and still recorded.
    expect(listCreatedArtifacts()).toHaveLength(4);
    for (const artifact of result.artifacts) {
      expect(fs.existsSync(artifact.filePath!)).toBe(true);
    }
  });
});

describe('createDataEntitySet — third write fails', () => {
  it('rolls back the first two in reverse order and leaves nothing recorded', async () => {
    const rollbackOrder: string[] = [];

    mockCreate.mockImplementation(async (req: any) => {
      const { objectName } = req.params.arguments;
      if (objectName === 'ContosoTestRecordEntityView') {
        return { content: [{ type: 'text', text: '❌ Error creating D365FO file: disk full' }], isError: true };
      }
      return succeedFor(objectName);
    });

    const { context, cleaned } = makeContext();
    const result = await createDataEntitySet(BASE_INPUT, context);

    expect(result.success).toBe(false);

    const byName = Object.fromEntries(result.artifacts.map(a => [a.objectName, a]));
    expect(byName['ContosoTestRecordEntity'].status).toBe('rolled-back');
    expect(byName['ContosoTestRecordStaging'].status).toBe('rolled-back');
    expect(byName['ContosoTestRecordEntityView'].status).toBe('failed');
    expect(byName['ContosoTestRecordEntityView'].message).toMatch(/disk full/);
    // The fourth was never attempted — the loop stops at the first failure.
    expect(byName['ContosoTestRecordEntityMaintain'].status).toBe('not-attempted');
    expect(mockCreate).toHaveBeenCalledTimes(3);

    // Rollback ran most-recent-first: staging before entity.
    rollbackOrder.push(...cleaned);
    expect(rollbackOrder).toEqual([
      path.join(tmpDir, 'ContosoTestRecordStaging.xml'),
      path.join(tmpDir, 'ContosoTestRecordEntity.xml'),
    ]);

    // Both files really are gone, and the ledger is clean.
    expect(fs.existsSync(path.join(tmpDir, 'ContosoTestRecordEntity.xml'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'ContosoTestRecordStaging.xml'))).toBe(false);
    expect(listCreatedArtifacts()).toEqual([]);

    // Both rollbacks reported the real outcome from the rollback primitive.
    expect(byName['ContosoTestRecordEntity'].rollbackStatus).toBe('rolled-back');
    expect(byName['ContosoTestRecordStaging'].rollbackStatus).toBe('rolled-back');

    expect(result.summary).toMatch(/Data entity set FAILED/);
  });

  it('reports rollback-failed (not clean) when a created file cannot be removed', async () => {
    mockCreate.mockImplementation(async (req: any) => {
      const { objectName } = req.params.arguments;
      if (objectName === 'ContosoTestRecordStaging') {
        return { content: [{ type: 'text', text: '❌ staging write failed' }], isError: true };
      }
      // Succeed WITHOUT recording in the ledger, so rollback has nothing to act on.
      return { content: [{ type: 'text', text: '✅ created (unrecorded)' }] };
    });

    const { context } = makeContext();
    const result = await createDataEntitySet(BASE_INPUT, context);

    expect(result.success).toBe(false);

    const entity = result.artifacts.find(a => a.objectName === 'ContosoTestRecordEntity')!;
    expect(entity.status).toBe('rollback-failed');
    expect(entity.message).toMatch(/no ledger entry/i);
    expect(result.summary).toMatch(/could NOT be rolled back automatically/);
  });

  it('treats a thrown create as a failure and rolls back what preceded it', async () => {
    mockCreate.mockImplementation(async (req: any) => {
      const { objectName } = req.params.arguments;
      if (objectName === 'ContosoTestRecordStaging') throw new Error('bridge pipe died');
      return succeedFor(objectName);
    });

    const { context } = makeContext();
    const result = await createDataEntitySet(BASE_INPUT, context);

    expect(result.success).toBe(false);

    const byName = Object.fromEntries(result.artifacts.map(a => [a.objectName, a]));
    expect(byName['ContosoTestRecordStaging'].status).toBe('failed');
    expect(byName['ContosoTestRecordStaging'].message).toMatch(/bridge pipe died/);
    expect(byName['ContosoTestRecordEntity'].status).toBe('rolled-back');
    expect(listCreatedArtifacts()).toEqual([]);
  });
});
