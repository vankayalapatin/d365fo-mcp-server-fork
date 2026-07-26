/**
 * Data entity set — AxSecurityPrivilege builder.
 *
 * Ground truth: docs/data-entity-set-findings.md §5, captured from the real VS
 * Data Entity Wizard. Verified against tests/fixtures/data-entity/
 * ContosoTestRecordEntityView.xml and ContosoTestRecordEntityMaintain.xml
 * byte-for-byte (tests/tools/dataEntitySet/privilegeXml.test.ts).
 *
 * This is a NEW, narrowly-scoped builder — not a reuse of
 * ../securityPrivilegeXml.ts. That existing builder emits a `<Label>` element
 * and a non-self-closing `<EntryPoints></EntryPoints>` when there's no target
 * menu item; the wizard's data-entity-only privilege has neither (no Label at
 * all, and a self-closing `<EntryPoints />`). Reusing it would mean threading
 * flags through an unrelated entry-point/menu-item code path just to suppress
 * output it was never designed to omit.
 *
 * Golden rule (findings §1): generated XML contains only non-default values.
 * Grant elements are alphabetical, matching the Microsoft serializer:
 *   - view:     Read
 *   - maintain: Correct, Create, Delete, Read, Update
 * Grant comes BEFORE Name inside AxSecurityDataEntityPermission — unlike
 * AxSecurityEntryPointReference elsewhere, which is Name-first.
 */

import type { DataEntitySetNames } from './names.js';

export type DataEntityAccessLevel = 'view' | 'maintain';

const VIEW_GRANTS = ['Read'];
const MAINTAIN_GRANTS = ['Correct', 'Create', 'Delete', 'Read', 'Update'];

function buildGrantXml(accessLevel: DataEntityAccessLevel): string {
  const grants = accessLevel === 'maintain' ? MAINTAIN_GRANTS : VIEW_GRANTS;
  return grants.map(g => `\t\t\t\t<${g}>Allow</${g}>`).join('\n');
}

/**
 * Build a single AxSecurityPrivilege XML file granting `accessLevel` on
 * `entityName` (a data entity's AOT name).
 */
export function buildDataEntityPrivilegeXml(
  privilegeName: string,
  entityName: string,
  accessLevel: DataEntityAccessLevel,
): string {
  const grantXml = buildGrantXml(accessLevel);

  return `<?xml version="1.0" encoding="utf-8"?>
<AxSecurityPrivilege xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${privilegeName}</Name>
\t<DataEntityPermissions>
\t\t<AxSecurityDataEntityPermission>
\t\t\t<Grant>
${grantXml}
\t\t\t</Grant>
\t\t\t<Name>${entityName}</Name>
\t\t\t<Fields />
\t\t\t<Methods />
\t\t</AxSecurityDataEntityPermission>
\t</DataEntityPermissions>
\t<DirectAccessPermissions />
\t<EntryPoints />
\t<FormControlOverrides />
</AxSecurityPrivilege>
`;
}

export interface DataEntitySetPrivilegeXml {
  viewPrivilegeXml: string;
  maintainPrivilegeXml: string;
}

/**
 * Build both privileges for a data entity set from the names already derived
 * by deriveDataEntitySetNames — the single place entity/staging/privilege
 * names are computed, so this can't drift from that derivation.
 */
export function buildDataEntitySetPrivilegeXml(names: DataEntitySetNames): DataEntitySetPrivilegeXml {
  return {
    viewPrivilegeXml: buildDataEntityPrivilegeXml(names.viewPrivilegeName, names.entityName, 'view'),
    maintainPrivilegeXml: buildDataEntityPrivilegeXml(names.maintainPrivilegeName, names.entityName, 'maintain'),
  };
}
