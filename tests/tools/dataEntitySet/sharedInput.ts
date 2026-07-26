/**
 * The canonical orchestrator input for the captured fixture set
 * (tests/fixtures/data-entity/, source table ContosoTestRecord).
 *
 * Shared deliberately, as the seam between Layer 3 and Layer 2:
 *   - resolveInput.test.ts asserts the RESOLVER produces exactly this from an
 *     entity name + a mocked readTable
 *   - orchestrator.test.ts feeds exactly this INTO createDataEntitySet
 * so together they prove the two layers compose. If the resolver's output ever
 * drifts from what the orchestrator consumes, one of the two suites breaks.
 *
 * `import type` keeps this a compile-time-only dependency on orchestrator.ts,
 * so importing this module does not pull the create path into a test's runtime.
 */

import type { DataEntitySetOrchestratorInput } from '../../../src/tools/dataEntitySet/orchestrator';

export const BASE_INPUT: DataEntitySetOrchestratorInput = {
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
