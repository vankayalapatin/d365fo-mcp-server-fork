/**
 * buildDataEntitySetStagingTableXml (src/tools/dataEntitySet/stagingTableXml.ts).
 *
 * Byte-for-byte comparison against the verified fixture captured from the real
 * VS Data Entity Wizard on a UDE machine
 * (tests/fixtures/data-entity/ContosoTestRecordStaging.xml,
 * docs/data-entity-set-findings.md §4): source table ContosoTestRecord,
 * business fields Name/Gender/Country, Name is the key field (also the
 * entity's key field — must match what entityXml.test.ts used).
 *
 * Business field types/labels are taken from
 * tests/fixtures/data-entity/ContosoTestRecord.xml:
 *   Name   — AxTableFieldString, ExtendedDataType=Name, no Label
 *   Gender — AxTableFieldString, no ExtendedDataType, Label=@Contoso:ContosoTestRecordGender
 *   Country — AxTableFieldString, no ExtendedDataType, Label=@Contoso:ContosoTestRecordCountry
 *
 * Only line-ending normalization (CRLF → LF) is applied before comparing —
 * tab indentation, element order, and the trailing newline must match exactly.
 * Driven through deriveDataEntitySetNames so staging/entity names can't drift
 * from the naming module.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDataEntitySetStagingTableXml } from '../../../src/tools/dataEntitySet/stagingTableXml';
import { deriveDataEntitySetNames } from '../../../src/tools/dataEntitySet/names';

const FIXTURES_DIR = join(__dirname, '../../fixtures/data-entity');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8').replace(/\r\n/g, '\n');
}

describe('buildDataEntitySetStagingTableXml — fixture byte-for-byte match', () => {
  it('matches ContosoTestRecordStaging.xml exactly, driven by deriveDataEntitySetNames', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');

    const xml = buildDataEntitySetStagingTableXml({
      names,
      label: '@Contoso:ContosoTestRecordTable',
      titleField1: 'Name',
      titleField2: 'Gender',
      businessFields: [
        { name: 'Name', extendedDataType: 'Name' },
        { name: 'Gender', label: '@Contoso:ContosoTestRecordGender' },
        { name: 'Country', label: '@Contoso:ContosoTestRecordCountry' },
      ],
      keyFields: ['Name'],
    }).replace(/\r\n/g, '\n');

    expect(xml).toBe(readFixture('ContosoTestRecordStaging.xml'));
  });
});

describe('buildDataEntitySetStagingTableXml — input validation', () => {
  it('throws when no key fields are given', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');
    expect(() => buildDataEntitySetStagingTableXml({
      names,
      label: '@Contoso:ContosoTestRecordTable',
      titleField1: 'Name',
      titleField2: 'Gender',
      businessFields: [{ name: 'Name', extendedDataType: 'Name' }],
      keyFields: [],
    })).toThrow();
  });
});
