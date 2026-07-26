/**
 * assembleDataEntitySet (src/tools/dataEntitySet/assemble.ts) — Layer 1.
 *
 * Byte-for-byte comparison of ALL FOUR artifacts against the verified fixture
 * set captured from the real VS Data Entity Wizard on a UDE machine
 * (tests/fixtures/data-entity/, docs/data-entity-set-findings.md), driven
 * through the single assembly entry point rather than the individual builders.
 *
 * Only line-ending normalization (CRLF → LF) is applied — and only to the
 * FIXTURE side, on read. The generated XML is compared exactly as produced.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { assembleDataEntitySet, type DataEntitySetAssembleInput } from '../../../src/tools/dataEntitySet/assemble';

const FIXTURES_DIR = join(__dirname, '../../fixtures/data-entity');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8').replace(/\r\n/g, '\n');
}

/** The fixture set's inputs: source table ContosoTestRecord, key field Name. */
const FIXTURE_INPUT: DataEntitySetAssembleInput = {
  entityName: 'ContosoTestRecordEntity',
  modelPrefix: 'Contoso',
  sourceTable: 'ContosoTestRecord',
  label: '@Contoso:ContosoTestRecordTable',
  titleField1: 'Name',
  titleField2: 'Gender',
  businessFields: [
    { name: 'Name', extendedDataType: 'Name' },
    { name: 'Gender', label: '@Contoso:ContosoTestRecordGender' },
    { name: 'Country', label: '@Contoso:ContosoTestRecordCountry' },
  ],
  keyFields: ['Name'],
};

describe('assembleDataEntitySet — all four artifacts match the fixtures byte-for-byte', () => {
  it('produces the entity, staging table, and both privileges in dependency order', () => {
    const { artifacts } = assembleDataEntitySet(FIXTURE_INPUT);

    expect(artifacts.map(a => ({ objectName: a.objectName, objectType: a.objectType }))).toEqual([
      { objectName: 'ContosoTestRecordEntity', objectType: 'data-entity' },
      { objectName: 'ContosoTestRecordStaging', objectType: 'table' },
      { objectName: 'ContosoTestRecordEntityView', objectType: 'security-privilege' },
      { objectName: 'ContosoTestRecordEntityMaintain', objectType: 'security-privilege' },
    ]);
  });

  it('entity XML matches ContosoTestRecordEntity.xml', () => {
    const { artifacts } = assembleDataEntitySet(FIXTURE_INPUT);
    expect(artifacts[0].xml).toBe(readFixture('ContosoTestRecordEntity.xml'));
  });

  it('staging table XML matches ContosoTestRecordStaging.xml', () => {
    const { artifacts } = assembleDataEntitySet(FIXTURE_INPUT);
    expect(artifacts[1].xml).toBe(readFixture('ContosoTestRecordStaging.xml'));
  });

  it('view privilege XML matches ContosoTestRecordEntityView.xml', () => {
    const { artifacts } = assembleDataEntitySet(FIXTURE_INPUT);
    expect(artifacts[2].xml).toBe(readFixture('ContosoTestRecordEntityView.xml'));
  });

  it('maintain privilege XML matches ContosoTestRecordEntityMaintain.xml', () => {
    const { artifacts } = assembleDataEntitySet(FIXTURE_INPUT);
    expect(artifacts[3].xml).toBe(readFixture('ContosoTestRecordEntityMaintain.xml'));
  });

  it('exposes the single name derivation every artifact was built from', () => {
    const { names } = assembleDataEntitySet(FIXTURE_INPUT);
    expect(names.entityName).toBe('ContosoTestRecordEntity');
    expect(names.stagingTableName).toBe('ContosoTestRecordStaging');
    expect(names.publicEntityName).toBe('TestRecord');
    expect(names.publicCollectionName).toBe('TestRecord');
  });
});

describe('assembleDataEntitySet — input validation', () => {
  it('throws when no business fields are given', () => {
    expect(() => assembleDataEntitySet({ ...FIXTURE_INPUT, businessFields: [] })).toThrow();
  });

  it('throws when no key fields are given', () => {
    expect(() => assembleDataEntitySet({ ...FIXTURE_INPUT, keyFields: [] })).toThrow();
  });

  it('throws when a key field does not name a selected business field', () => {
    expect(() => assembleDataEntitySet({ ...FIXTURE_INPUT, keyFields: ['NotAField'] }))
      .toThrow(/not among the selected business fields/);
  });
});
