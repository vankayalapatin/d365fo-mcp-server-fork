/**
 * deriveDataEntitySetNames (src/tools/dataEntitySet/names.ts).
 *
 * Expected values are read directly off the verified fixture set captured from
 * the real VS Data Entity Wizard on a UDE machine
 * (tests/fixtures/data-entity/, docs/data-entity-set-findings.md §2):
 *   ContosoTestRecordEntity.xml         — PublicEntityName/PublicCollectionName = TestRecord
 *   ContosoTestRecordStaging.xml        — staging table = ContosoTestRecordStaging
 *   ContosoTestRecordEntityView.xml     — privilege = ContosoTestRecordEntityView
 *   ContosoTestRecordEntityMaintain.xml — privilege = ContosoTestRecordEntityMaintain
 */

import { describe, it, expect } from 'vitest';
import { deriveDataEntitySetNames } from '../../../src/tools/dataEntitySet/names';

describe('deriveDataEntitySetNames', () => {
  it('derives all four artifact names from the fixture entity (ContosoTestRecordEntity, prefix Contoso)', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');

    expect(names.entityName).toBe('ContosoTestRecordEntity');
    expect(names.baseName).toBe('TestRecord');
    expect(names.stagingTableName).toBe('ContosoTestRecordStaging');
    expect(names.viewPrivilegeName).toBe('ContosoTestRecordEntityView');
    expect(names.maintainPrivilegeName).toBe('ContosoTestRecordEntityMaintain');
    expect(names.publicEntityName).toBe('TestRecord');
    expect(names.publicCollectionName).toBe('TestRecord');
  });

  it('public entity name and public collection name are always identical', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');
    expect(names.publicCollectionName).toBe(names.publicEntityName);
  });

  it('does not strip the prefix when entityName does not start with it (no silent mangling)', () => {
    const names = deriveDataEntitySetNames('OtherTestRecordEntity', 'Contoso');
    expect(names.baseName).toBe('OtherTestRecord');
    expect(names.publicEntityName).toBe('OtherTestRecord');
    // stagingTableName is derived from entityName alone (no prefix arithmetic),
    // so it's just entityName with "Entity" stripped + "Staging" appended. This
    // non-prefixed-mismatch case is NOT covered by a real wizard fixture — only
    // the ContosoTestRecordEntity case above is verified ground truth.
    expect(names.stagingTableName).toBe('OtherTestRecordStaging');
  });

  it('leaves baseName unchanged when entityName has no trailing "Entity" suffix', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecord', 'Contoso');
    expect(names.baseName).toBe('TestRecord');
    expect(names.viewPrivilegeName).toBe('ContosoTestRecordView');
  });

  it('handles an empty model prefix without stripping anything', () => {
    const names = deriveDataEntitySetNames('TestRecordEntity', '');
    expect(names.baseName).toBe('TestRecord');
    expect(names.stagingTableName).toBe('TestRecordStaging');
    expect(names.publicEntityName).toBe('TestRecord');
  });

  it('throws on an empty entityName', () => {
    expect(() => deriveDataEntitySetNames('', 'Contoso')).toThrow();
  });
});
