/**
 * CHARACTERIZATION tests for undo_last_modification's non-git ledger rollback.
 *
 * Written BEFORE extracting that logic into src/tools/rollbackCreatedArtifact.ts,
 * to pin the current behaviour so the extraction is provably behaviour-preserving.
 * These assert what the code DOES today, not what it ideally should do.
 *
 * tests/tools/undo-ledger.test.ts already covers three branches:
 *   - happy path: recorded file is deleted and forgotten from the ledger
 *   - safety: an unrecorded file is refused and left on disk
 *   - .rnrproj <Content Include> (and orphaned <Folder Include>) cleanup
 * but every case there passes `{} as any` as the server context, so the index
 * cleanup step never actually executes. This file covers the remainder:
 *   - index + label cleanup is invoked with the deleted file's path
 *   - the "file already gone but still in the ledger" branch
 *   - the "path is a directory, not a file" refusal
 *
 * Deliberately NOT covered here: the git branch of undoLastModificationTool.
 * It is out of scope for the extraction and is left untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { undoLastModificationTool } from '../../src/tools/undoLastModification';
import {
  recordCreatedArtifact,
  lookupCreatedArtifact,
  _clearCreatedArtifactLedger,
} from '../../src/tools/createdArtifactLedger';

let tmpDir: string;

/** Records the index-cleanup calls the rollback makes, so they can be asserted. */
function makeFakeContext() {
  const calls = { removeSymbolsByFile: [] as string[], removeLabelsByFile: [] as string[] };
  return {
    calls,
    context: {
      symbolIndex: {
        removeSymbolsByFile(filePath: string) {
          calls.removeSymbolsByFile.push(filePath);
          return { deletedCount: 2, objectNames: ['ConDemoThing'] };
        },
        removeLabelsByFile(filePath: string) {
          calls.removeLabelsByFile.push(filePath);
          return 1;
        },
      },
      // No bridge — bridgeRefreshProvider returns null for an undefined bridge.
    } as any,
  };
}

beforeEach(() => {
  _clearCreatedArtifactLedger();
  // os.tmpdir() is not a git repo, so `git rev-parse` fails exactly as it does
  // in K:\AosService\PackagesLocalDirectory and the ledger path is taken.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-char-'));
});

afterEach(() => {
  _clearCreatedArtifactLedger();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('undo_last_modification ledger rollback — characterization', () => {
  it('cleans the symbol index and label index for the deleted file', async () => {
    const filePath = path.join(tmpDir, 'ConDemoThing.xml');
    fs.writeFileSync(filePath, '<AxClass><Name>ConDemoThing</Name></AxClass>', 'utf-8');
    recordCreatedArtifact({ filePath, objectType: 'class', objectName: 'ConDemoThing' });

    const { calls, context } = makeFakeContext();
    const result = await undoLastModificationTool({ filePath }, context);

    expect(result.isError).toBeFalsy();
    expect(fs.existsSync(filePath)).toBe(false);
    // Index cleanup ran, keyed by the deleted file's path.
    expect(calls.removeSymbolsByFile).toEqual([filePath]);
    expect(calls.removeLabelsByFile).toEqual([filePath]);
    expect(result.content[0].text).toMatch(/Stale index entries cleaned up/i);
  });

  it('handles a recorded file that is already gone: cleans project + index, forgets it, no error', async () => {
    const filePath = path.join(tmpDir, 'ConDemoGone.xml');
    // Recorded as created, but removed by hand before undo runs.
    recordCreatedArtifact({ filePath, objectType: 'class', objectName: 'ConDemoGone' });
    expect(fs.existsSync(filePath)).toBe(false);

    const { calls, context } = makeFakeContext();
    const result = await undoLastModificationTool({ filePath }, context);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/already removed/i);
    // Still cleans up and forgets, so the session's state stays consistent.
    expect(lookupCreatedArtifact(filePath)).toBeUndefined();
    expect(calls.removeSymbolsByFile).toEqual([filePath]);
  });

  it('refuses to delete a recorded path that is a directory rather than a file', async () => {
    const dirPath = path.join(tmpDir, 'NotAFile');
    fs.mkdirSync(dirPath);
    recordCreatedArtifact({ filePath: dirPath, objectType: 'class', objectName: 'NotAFile' });

    const { calls, context } = makeFakeContext();
    const result = await undoLastModificationTool({ filePath: dirPath }, context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Refusing to delete non-file path/i);
    expect(fs.existsSync(dirPath)).toBe(true);
    // The refusal happens before any cleanup, and the ledger entry survives.
    expect(calls.removeSymbolsByFile).toEqual([]);
    expect(lookupCreatedArtifact(dirPath)).toBeDefined();
  });

  it('reports the project file in the success message when the create recorded one', async () => {
    const filePath = path.join(tmpDir, 'ConDemoWithProj.xml');
    fs.writeFileSync(filePath, '<AxClass/>', 'utf-8');
    const projectPath = path.join(tmpDir, 'Contoso.rnrproj');
    fs.writeFileSync(projectPath, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">',
      '  <ItemGroup>',
      '    <Content Include="AxClass\\ConDemoWithProj">',
      '      <SubType>Content</SubType>',
      '      <Name>ConDemoWithProj</Name>',
      '    </Content>',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n'), 'utf-8');

    recordCreatedArtifact({ filePath, objectType: 'class', objectName: 'ConDemoWithProj', projectPath });

    const { context } = makeFakeContext();
    const result = await undoLastModificationTool({ filePath }, context);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/Removed its project entry from Contoso\.rnrproj/);
  });
});
