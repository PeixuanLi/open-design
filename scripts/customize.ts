// scripts/customize.ts
// Pre-build branding customization script.
// Replaces "Open Design" → brand name, GitHub URLs → custom repo,
// and injects Discord conditional guards.
// All values are hardcoded. Run manually: pnpm customize

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ===== HARDCODED BRANDING VALUES =====

const NEW_BRAND = 'Dmas Design';
const NEW_BRAND_PILL = 'Preview';
const NEW_BRAND_SUBTITLE = 'by Dmas Studio';
const NEW_KEBAB = 'Dmas-Design';

const NEW_GITHUB_URL = 'https://github.com/dmas-studio/dmas-design';
const NEW_GITHUB_API = 'https://api.github.com/repos/dmas-studio/dmas-design';
const NEW_GITHUB_LABEL = 'dmas-studio/dmas-design';

// ===== UTILITIES =====

interface ReplaceStats {
  file: string;
  count: number;
}

const stats: ReplaceStats[] = [];

/**
 * Replace all occurrences of `old` with `replacement` in `file`.
 * Idempotent: skips if `old` is not found (already replaced or not applicable).
 * Prints [OK] on success, [WARN] if file not found.
 */
function simpleReplace(file: string, old: string, replacement: string, desc: string): void {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    console.warn(`  [WARN] file not found, skipping: ${file} (${desc})`);
    return;
  }
  if (!content.includes(old)) {
    return; // already replaced or not applicable — idempotent
  }
  const parts = content.split(old);
  const count = parts.length - 1;
  const updated = content.replaceAll(old, replacement);
  writeFileSync(file, updated);
  stats.push({ file, count });
  console.log(`  [OK] ${desc} (${count} occurrence(s))`);
}

/** Check git porcelain and exit if dirty. */
function requireCleanTree(): void {
  let out: string;
  try {
    out = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('Error: failed to run git status:', String(err));
    process.exit(1);
  }
  if (out) {
    console.error('Error: 工作区有未提交的修改，请先 commit 或 stash。');
    console.error('Uncommitted changes:');
    console.error(out);
    process.exit(1);
  }
}

// ===== REPLACEMENT FUNCTIONS (filled in by Tasks 3-6) =====

function applyNameReplacements(): void {
  // TODO: filled in by Task 3
}

function applyUrlReplacements(): void {
  // TODO: filled in by Task 4
}

function applyDiscordGuards(): void {
  // TODO: filled in by Task 5
}

function applyStarReplacements(): void {
  // TODO: filled in by Task 6
}

// ===== MAIN =====

function main(): void {
  requireCleanTree();

  console.log('=== customize: brand name ===');
  applyNameReplacements();

  console.log('\n=== customize: GitHub URLs ===');
  applyUrlReplacements();

  console.log('\n=== customize: Discord guards ===');
  applyDiscordGuards();

  console.log('\n=== customize: GitHub Star ===');
  applyStarReplacements();

  console.log('\n=== Summary ===');
  const totalFiles = stats.length;
  const totalOccurrences = stats.reduce((sum, s) => sum + s.count, 0);
  console.log(`Modified ${totalFiles} file(s), ${totalOccurrences} replacement(s).`);
  console.log('Run `pnpm customize:restore` to undo all changes.');
}

main();
