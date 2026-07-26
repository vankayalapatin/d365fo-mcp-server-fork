/**
 * buildDataEntityPrivilegeXml / buildDataEntitySetPrivilegeXml
 * (src/tools/dataEntitySet/privilegeXml.ts).
 *
 * Byte-for-byte comparison against the verified fixture set captured from the
 * real VS Data Entity Wizard on a UDE machine
 * (tests/fixtures/data-entity/, docs/data-entity-set-findings.md §5):
 *   ContosoTestRecordEntityView.xml     — Grant: Read only
 *   ContosoTestRecordEntityMaintain.xml — Grant: Correct, Create, Delete, Read, Update
 *
 * Only line-ending normalization (CRLF → LF) is applied before comparing —
 * everything else (tab indentation, element order, trailing newline) must match
 * exactly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDataEntityPrivilegeXml, buildDataEntitySetPrivilegeXml } from '../../../src/tools/dataEntitySet/privilegeXml';
import { deriveDataEntitySetNames } from '../../../src/tools/dataEntitySet/names';

const FIXTURES_DIR = join(__dirname, '../../fixtures/data-entity');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8').replace(/\r\n/g, '\n');
}

describe('buildDataEntityPrivilegeXml — fixture byte-for-byte match', () => {
  it('matches ContosoTestRecordEntityView.xml exactly (view: Read only)', () => {
    const xml = buildDataEntityPrivilegeXml('ContosoTestRecordEntityView', 'ContosoTestRecordEntity', 'view')
      .replace(/\r\n/g, '\n');
    expect(xml).toBe(readFixture('ContosoTestRecordEntityView.xml'));
  });

  it('matches ContosoTestRecordEntityMaintain.xml exactly (maintain: Correct, Create, Delete, Read, Update)', () => {
    const xml = buildDataEntityPrivilegeXml('ContosoTestRecordEntityMaintain', 'ContosoTestRecordEntity', 'maintain')
      .replace(/\r\n/g, '\n');
    expect(xml).toBe(readFixture('ContosoTestRecordEntityMaintain.xml'));
  });
});

describe('buildDataEntitySetPrivilegeXml — driven by deriveDataEntitySetNames', () => {
  it('produces both fixtures exactly when fed the fixture entity\'s derived names', () => {
    const names = deriveDataEntitySetNames('ContosoTestRecordEntity', 'Contoso');
    const { viewPrivilegeXml, maintainPrivilegeXml } = buildDataEntitySetPrivilegeXml(names);

    expect(viewPrivilegeXml.replace(/\r\n/g, '\n')).toBe(readFixture('ContosoTestRecordEntityView.xml'));
    expect(maintainPrivilegeXml.replace(/\r\n/g, '\n')).toBe(readFixture('ContosoTestRecordEntityMaintain.xml'));
  });
});
