/**
 * buildDataEntitySetEntityXml (src/tools/dataEntitySet/entityXml.ts).
 *
 * Byte-for-byte comparison against the verified fixture captured from the real
 * VS Data Entity Wizard on a UDE machine
 * (tests/fixtures/data-entity/ContosoTestRecordEntity.xml,
 * docs/data-entity-set-findings.md §3): source table ContosoTestRecord,
 * fields Name/Gender/Country, Name is the (mandatory) key field.
 *
 * Only line-ending normalization (CRLF → LF) is applied before comparing —
 * everything else (tab indentation, element order, CDATA content, trailing
 * newline) must match exactly. Driven through deriveDataEntitySetNames so the
 * entity/staging/public names can't drift from the naming module.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDataEntitySetEntityXml } from '../../../src/tools/dataEntitySet/entityXml';
import { deriveDataEntitySetNames } from '../../../src/tools/dataEntitySet/names';

const FIXTURES_DIR = join(__dirname, '../../fixtures/data-entity');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8').replace(/\r\n/g, '\n');
}

describe('buildDataEntitySetEntityXml — fixture byte-for-byte match', () => {
  it('matches ContosoTestRecordEntity.xml exactly, driven by deriveDataEntitySetNames', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');

    const xml = buildDataEntitySetEntityXml({
      names,
      primaryTable: 'ContosoTestRecord',
      label: '@Contoso:ContosoTestRecordTable',
      fields: [
        { name: 'Name' },
        { name: 'Gender' },
        { name: 'Country' },
      ],
      keyFields: ['Name'],
    }).replace(/\r\n/g, '\n');

    expect(xml).toBe(readFixture('ContosoTestRecordEntity.xml'));
  });
});

describe('buildDataEntitySetEntityXml — input validation', () => {
  it('throws when no fields are given', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');
    expect(() => buildDataEntitySetEntityXml({
      names,
      primaryTable: 'ContosoTestRecord',
      label: '@Contoso:ContosoTestRecordTable',
      fields: [],
      keyFields: ['Name'],
    })).toThrow();
  });

  it('throws when no key fields are given', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');
    expect(() => buildDataEntitySetEntityXml({
      names,
      primaryTable: 'ContosoTestRecord',
      label: '@Contoso:ContosoTestRecordTable',
      fields: [{ name: 'Name' }],
      keyFields: [],
    })).toThrow();
  });
});
