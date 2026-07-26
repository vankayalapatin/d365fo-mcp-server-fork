/**
 * Data entity set — thin adapter between the d365fo_file facade and the
 * resolver + orchestrator.
 *
 * Owns no logic of its own: it reads set-mode arguments off the already-parsed
 * d365fo_file args, runs resolveDataEntitySetInput → createDataEntitySet, and
 * renders one text response. Nothing here writes files or talks to the bridge
 * beyond what those two already do.
 *
 * WHY THE BRANCH LIVES IN THE FACADE, NOT IN handleCreateD365File
 * ---------------------------------------------------------------
 * createDataEntitySet calls handleCreateD365File FOUR times internally, once
 * per artifact. If set-mode were detected inside handleCreateD365File, each of
 * those four calls would re-enter set-mode and recurse without bound. Branching
 * in d365foFileTool — before handleCreateD365File is ever reached — is what
 * keeps the orchestrator's internal calls plain single-file creates.
 *
 * Contract: this never throws. Every failure (resolver, input validation,
 * anything unexpected) comes back as { isError: true } with a readable message,
 * matching the leaf-handler convention used across src/tools.
 */

import type { XppServerContext } from '../../types/context.js';
import {
  resolveDataEntitySetInput,
  DataEntitySetResolveError,
} from './resolveInput.js';
import { createDataEntitySet, DataEntitySetInputError } from './orchestrator.js';

/** Read a string arg, treating blank/whitespace as absent. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Key fields may arrive as a real array or — as agents often send them — a
 * comma-separated string. Accept both rather than silently producing a
 * single-element key named "Name, Country".
 */
function keyFieldList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const names = value.map(v => str(v)).filter((v): v is string => !!v);
    return names.length > 0 ? names : undefined;
  }
  const raw = str(value);
  if (!raw) return undefined;
  const names = raw.split(',').map(s => s.trim()).filter(Boolean);
  return names.length > 0 ? names : undefined;
}

/**
 * True when the caller asked for a full data entity set rather than a single
 * file. `sourceTable` is the discriminator — its presence is what the facade
 * branches on.
 */
export function isDataEntitySetRequest(args: Record<string, unknown>): boolean {
  return str(args.sourceTable) !== undefined;
}

/**
 * Build the four-artifact data entity set from d365fo_file's parsed arguments.
 *
 * `entityName` falls back to `objectName`, so the natural facade call
 *   d365fo_file(action="create", objectType="data-entity",
 *               objectName="ContosoTestRecordEntity", sourceTable="ContosoTestRecord")
 * works without a second name argument.
 */
export async function handleDataEntitySetCreate(
  args: Record<string, unknown>,
  context: XppServerContext,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const sourceTable = str(args.sourceTable);
    const entityName = str(args.entityName) ?? str(args.objectName);

    if (!sourceTable) {
      return {
        content: [{ type: 'text', text: '❌ d365fo_file (data entity set): `sourceTable` is required.' }],
        isError: true,
      };
    }
    if (!entityName) {
      return {
        content: [{
          type: 'text',
          text:
            '❌ d365fo_file (data entity set): the entity name is required — pass `entityName` ' +
            '(or `objectName`), e.g. entityName="ContosoTestRecordEntity".',
        }],
        isError: true,
      };
    }

    const { input, warnings } = await resolveDataEntitySetInput(
      {
        entityName,
        sourceTable,
        titleField1: str(args.titleField1),
        titleField2: str(args.titleField2),
        keyFields: keyFieldList(args.keyFields),
        modelName: str(args.modelName),
        packageName: str(args.packageName),
        packagePath: str(args.packagePath),
        projectPath: str(args.projectPath),
        solutionPath: str(args.solutionPath),
        addToProject: typeof args.addToProject === 'boolean' ? args.addToProject : undefined,
      },
      context,
    );

    // TODO(box): §12 double-prefix watch-item — verify on a real D365 box.
    // The orchestrator passes ALREADY-PREFIXED object names (ContosoTestRecordEntity,
    // ContosoTestRecordStaging, …) together with xmlContent into
    // handleCreateD365File, which still runs them through applyObjectPrefix.
    // That helper has a case-insensitive double-prefix guard, so this SHOULD be a
    // no-op — but it is unverified against a live PackagesLocalDirectory. Confirm
    // each written filename matches the <Name> inside its own XML, with no
    // "ContosoContoso…" doubling on either the file or the element.
    const result = await createDataEntitySet(input, context);

    const warningBlock = warnings.length > 0
      ? warnings.map(w => `⚠️ ${w}`).join('\n\n') + '\n\n'
      : '';

    return {
      content: [{ type: 'text', text: warningBlock + result.summary }],
      isError: !result.success,
    };
  } catch (e) {
    // Resolver and input-validation failures are expected control flow, not
    // crashes; everything else is funnelled here too so the handler contract
    // ("never throw") holds unconditionally.
    const prefix = e instanceof DataEntitySetResolveError
      ? '❌ d365fo_file (data entity set) — could not resolve the source table'
      : e instanceof DataEntitySetInputError
        ? '❌ d365fo_file (data entity set) — invalid input'
        : '❌ d365fo_file (data entity set) failed';
    return {
      content: [{ type: 'text', text: `${prefix}:\n\n${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
}
