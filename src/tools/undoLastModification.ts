import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import type { XppServerContext } from '../types/context.js';
import { rollbackCreatedArtifact, cleanupIndexAfterUndo } from './rollbackCreatedArtifact.js';

const execFileAsync = util.promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10,
    // Prevent a hung git from blocking the tool indefinitely.
    timeout: 30_000,
  });
  return stdout.trim();
}

function isInsideRepo(repoRoot: string, targetPath: string): boolean {
  const relative = path.relative(repoRoot, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toRepoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

// Tool registration (name, description, inputSchema) lives inline in
// src/server/mcpServer.ts - the single source of truth for tool instructions.

export const undoLastModificationTool = async (params: any, context: XppServerContext) => {
  const { filePath } = params;
  try {
    if (!filePath || typeof filePath !== 'string') {
      return {
        content: [{ type: 'text', text: 'Invalid filePath. Provide an absolute file path.' }],
        isError: true,
      };
    }

    // Use filePath as-is (already absolute); path.resolve() would add a Windows drive letter
    // to POSIX-style paths like /repo/src/a.ts → C:\repo\src\a.ts
    const absolutePath = filePath;
    const cwd = path.posix.dirname(filePath.replace(/\\/g, '/'));

    let repoRoot = '';
    try {
      repoRoot = await git(['rev-parse', '--show-toplevel'], cwd);
    } catch {
      // Not inside a git repository — e.g. the D365FO sandbox
      // K:\AosService\PackagesLocalDirectory. The git-based revert/delete cannot
      // help here. Fall back to the create-artifact ledger: undo may delete a file
      // ONLY when d365fo_file(action="create") recorded creating it (genuinely new)
      // in THIS server session. Anything not in the ledger keeps the original
      // "not inside a git repository" error — the non-git path never deletes an
      // arbitrary or pre-existing file.
      // (Corpus: eval/corpus/runs/2026-07-21T__L3-custom-service-basic__a2a4131.json.)
      const ledgerResult = await undoViaLedger(absolutePath, context);
      if (ledgerResult) return ledgerResult;
      return {
        content: [{ type: 'text', text: 'File is not inside a git repository: ' + absolutePath }],
        isError: true,
      };
    }

    if (!isInsideRepo(repoRoot, absolutePath)) {
      return {
        content: [{ type: 'text', text: 'Refusing operation outside repository root: ' + absolutePath }],
        isError: true,
      };
    }

    const relativePath = toRepoRelative(repoRoot, absolutePath);
    if (!relativePath || relativePath === '.') {
      return {
        content: [{ type: 'text', text: 'Refusing operation on repository root. Provide a file path.' }],
        isError: true,
      };
    }

    let tracked = false;
    try {
      await git(['ls-files', '--error-unmatch', '--', relativePath], repoRoot);
      tracked = true;
    } catch {
      tracked = false;
    }

    if (tracked) {
      await git(['checkout', 'HEAD', '--', relativePath], repoRoot);
      await cleanupIndexAfterUndo(context, absolutePath, 'reverted');
      return {
        content: [{ type: 'text', text: 'Successfully reverted tracked file modification: ' + absolutePath + '\nSymbol index updated to reflect the reverted state.' }],
      };
    }

    if (!fs.existsSync(absolutePath)) {
      return {
        content: [{ type: 'text', text: 'File not found and not tracked by git: ' + absolutePath }],
        isError: true,
      };
    }

    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) {
      return {
        content: [{ type: 'text', text: 'Refusing to delete non-file path: ' + absolutePath }],
        isError: true,
      };
    }

    let untracked = false;
    try {
      const out = await git(['ls-files', '--others', '--exclude-standard', '--', relativePath], repoRoot);
      untracked = out.split('\n').map(s => s.trim()).includes(relativePath);
    } catch {
      untracked = false;
    }

    if (!untracked) {
      return {
        content: [{ type: 'text', text: 'Refusing to delete file that is not a git-untracked file: ' + absolutePath }],
        isError: true,
      };
    }

    fs.unlinkSync(absolutePath);
    await cleanupIndexAfterUndo(context, absolutePath, 'deleted');
    return {
      content: [{ type: 'text', text: 'Successfully undid file creation (deleted untracked file): ' + absolutePath + '\nStale index entries cleaned up.' }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: 'Error undoing modifications: ' + error.message }],
      isError: true
    };
  }
};

/**
 * Non-git undo path. Safe by construction: it acts ONLY on a file that
 * d365fo_file(action="create") recorded creating (genuinely new) in this session.
 * Returns null when the path is not in the ledger, so the caller can fall back to
 * the original "not inside a git repository" error. Deletes the created file and
 * cleans its .rnrproj entry (when the create recorded a project) plus the index.
 */
async function undoViaLedger(
  absolutePath: string,
  context: XppServerContext,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  const outcome = await rollbackCreatedArtifact(absolutePath, context);

  switch (outcome.status) {
    case 'not-recorded':
      return null;

    case 'already-absent':
      return {
        content: [{ type: 'text', text: 'File already removed; cleaned project + index entries for session-created object: ' + absolutePath }],
      };

    case 'refused-not-a-file':
      return {
        content: [{ type: 'text', text: 'Refusing to delete non-file path: ' + absolutePath }],
        isError: true,
      };

    case 'rolled-back': {
      const projectNote = outcome.entry.projectPath
        ? '\nRemoved its project entry from ' + path.basename(outcome.entry.projectPath) + '.'
        : '';
      return {
        content: [{ type: 'text', text: 'Successfully undid file creation (deleted session-created file outside git): ' + absolutePath + projectNote + '\nStale index entries cleaned up.' }],
      };
    }
  }
}
