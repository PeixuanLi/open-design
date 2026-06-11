// scripts/customize-restore.ts
// Restore all files modified by customize.ts back to the git-index state.
// Runs `git checkout -- <file>` for every file with uncommitted changes.

import { execSync, execFileSync } from 'node:child_process';

function main(): void {
  let out: string;
  try {
    out = execSync('git diff --name-only', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('Error: failed to run git diff:', String(err));
    process.exit(1);
  }
  if (!out) {
    console.log('Nothing to restore — working tree is already clean.');
    return;
  }
  const files = out.split('\n').filter(Boolean);
  for (const file of files) {
    try {
      execFileSync('git', ['checkout', '--', file]);
    } catch (err) {
      console.error(`Error: failed to restore ${file}:`, String(err));
      process.exit(1);
    }
    console.log(`  restored: ${file}`);
  }
  console.log(`\nRestored ${files.length} file(s).`);
}

main();
