/**
 * createdArtifactLedger (src/tools/createdArtifactLedger.ts).
 *
 * Covers the two lookup helpers added for the multi-artifact create path
 * (listCreatedArtifacts / findCreatedArtifactByName), plus the record/lookup/
 * forget behaviour they build on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordCreatedArtifact,
  lookupCreatedArtifact,
  forgetCreatedArtifact,
  listCreatedArtifacts,
  findCreatedArtifactByName,
  ledgerKey,
  _clearCreatedArtifactLedger,
} from '../../src/tools/createdArtifactLedger';

beforeEach(() => _clearCreatedArtifactLedger());
afterEach(() => _clearCreatedArtifactLedger());

describe('listCreatedArtifacts', () => {
  it('returns an empty array when nothing was recorded', () => {
    expect(listCreatedArtifacts()).toEqual([]);
  });

  it('returns every recorded artifact in creation order', () => {
    recordCreatedArtifact({ filePath: 'K:\\a\\Entity.xml', objectType: 'data-entity', objectName: 'Entity' });
    recordCreatedArtifact({ filePath: 'K:\\a\\Staging.xml', objectType: 'table', objectName: 'Staging' });
    recordCreatedArtifact({ filePath: 'K:\\a\\View.xml', objectType: 'security-privilege', objectName: 'View' });

    expect(listCreatedArtifacts().map(a => a.objectName)).toEqual(['Entity', 'Staging', 'View']);
  });

  it('returns a copy — mutating the result does not affect the ledger', () => {
    recordCreatedArtifact({ filePath: 'K:\\a\\Entity.xml', objectType: 'data-entity', objectName: 'Entity' });

    const list = listCreatedArtifacts();
    list.pop();

    expect(listCreatedArtifacts()).toHaveLength(1);
  });

  it('drops forgotten entries', () => {
    recordCreatedArtifact({ filePath: 'K:\\a\\Entity.xml', objectType: 'data-entity', objectName: 'Entity' });
    recordCreatedArtifact({ filePath: 'K:\\a\\Staging.xml', objectType: 'table', objectName: 'Staging' });

    forgetCreatedArtifact('K:\\a\\Entity.xml');

    expect(listCreatedArtifacts().map(a => a.objectName)).toEqual(['Staging']);
  });
});

describe('findCreatedArtifactByName', () => {
  beforeEach(() => {
    recordCreatedArtifact({ filePath: 'K:\\a\\ConEntity.xml', objectType: 'data-entity', objectName: 'ConEntity' });
    recordCreatedArtifact({ filePath: 'K:\\a\\ConStaging.xml', objectType: 'table', objectName: 'ConStaging' });
  });

  it('finds a recorded artifact by object name', () => {
    expect(findCreatedArtifactByName('ConStaging')?.filePath).toBe('K:\\a\\ConStaging.xml');
  });

  it('matches case-insensitively (AOT identifiers are case-insensitive in X++)', () => {
    expect(findCreatedArtifactByName('conentity')?.objectName).toBe('ConEntity');
    expect(findCreatedArtifactByName('CONENTITY')?.objectName).toBe('ConEntity');
  });

  it('narrows by object type when given', () => {
    expect(findCreatedArtifactByName('ConStaging', 'table')?.filePath).toBe('K:\\a\\ConStaging.xml');
    expect(findCreatedArtifactByName('ConStaging', 'data-entity')).toBeUndefined();
  });

  it('returns undefined for an unknown name and for an empty name', () => {
    expect(findCreatedArtifactByName('NoSuchObject')).toBeUndefined();
    expect(findCreatedArtifactByName('')).toBeUndefined();
  });

  it('returns the most recently recorded match when a name was created twice', () => {
    recordCreatedArtifact({ filePath: 'K:\\b\\ConEntity.xml', objectType: 'data-entity', objectName: 'ConEntity' });
    expect(findCreatedArtifactByName('ConEntity')?.filePath).toBe('K:\\b\\ConEntity.xml');
  });
});

describe('record / lookup / forget (existing behaviour the helpers build on)', () => {
  it('looks up by path regardless of separator style or casing', () => {
    recordCreatedArtifact({ filePath: 'K:\\a\\Entity.xml', objectType: 'data-entity', objectName: 'Entity' });

    expect(lookupCreatedArtifact('K:\\a\\Entity.xml')).toBeDefined();
    expect(lookupCreatedArtifact('k:/a/entity.xml')).toBeDefined();
  });

  it('ignores a record with no filePath', () => {
    recordCreatedArtifact({ filePath: '' });
    expect(listCreatedArtifacts()).toEqual([]);
  });

  it('ledgerKey normalizes separators, trailing slashes, and case', () => {
    expect(ledgerKey('K:\\a\\Entity.xml')).toBe(ledgerKey('k:/a/entity.xml'));
  });
});
