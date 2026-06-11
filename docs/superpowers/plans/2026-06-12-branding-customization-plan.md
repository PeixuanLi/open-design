# 品牌名替换 + 社区链接替换 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `scripts/customize.ts` that replaces all brand names ("Open Design" → "Dmas Design"), GitHub URLs ("nexu-io/open-design" → custom repo), and conditionally hides Discord UI elements via pre-build text replacement, plus `scripts/customize-restore.ts` for reverting.

**Architecture:** Two standalone TypeScript scripts executed manually via `pnpm customize` / `pnpm customize:restore`. The customize script reads source files in-place, does exact string replacements, and injects conditional guards for Discord JSX. The restore script reverts via `git checkout`. Both require a clean git working tree.

**Tech Stack:** TypeScript, Node.js fs/child_process, tsx (for execution)

**Design Doc:** `docs/superpowers/specs/2026-06-12-branding-customization-design.md`

---

## File Structure

```
scripts/
├── customize.ts          # 主编排脚本（新建）
└── customize-restore.ts  # 恢复脚本（新建）

package.json              # 添加 customize / customize:restore scripts（修改）
```

---

### Task 1: Create `scripts/customize-restore.ts`

**Files:**
- Create: `scripts/customize-restore.ts`
- Modify: `package.json`

Start with the safety net — the restore script is simpler and gives us an undo path before we start modifying files.

- [ ] **Step 1: Write the restore script**

```typescript
// scripts/customize-restore.ts
// Restore all files modified by customize.ts back to the git-index state.
// Runs `git checkout -- <file>` for every file with uncommitted changes.

import { execSync } from 'node:child_process';

function main(): void {
  const out = execSync('git diff --name-only', { encoding: 'utf8' }).trim();
  if (!out) {
    console.log('Nothing to restore — working tree is already clean.');
    return;
  }
  const files = out.split('\n').filter(Boolean);
  for (const file of files) {
    execSync(`git checkout -- ${file}`);
    console.log(`  restored: ${file}`);
  }
  console.log(`\nRestored ${files.length} file(s).`);
}

main();
```

- [ ] **Step 2: Add npm scripts**

Only add the `customize:restore` script for now (`customize` will be added in Task 2):

```json
"customize:restore": "tsx scripts/customize-restore.ts"
```

- [ ] **Step 3: Verify restore works on a clean tree**

Run:
```bash
pnpm customize:restore
```
Expected output: `Nothing to restore — working tree is already clean.`

- [ ] **Step 4: Commit**

```bash
git add scripts/customize-restore.ts package.json
git commit -m "feat: add customize-restore script"
```

---

### Task 2: Create `scripts/customize.ts` — git check + simpleReplace utility

**Files:**
- Create: `scripts/customize.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the skeleton with git check and simpleReplace**

```typescript
// scripts/customize.ts
// Pre-build branding customization script.
// Replaces "Open Design" → brand name, GitHub URLs → custom repo,
// and injects Discord conditional guards.
// All values are hardcoded. Run manually: pnpm customize

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

interface Replacement {
  file: string;
  old: string;
  new: string;
  description: string;
}

interface ReplaceStats {
  file: string;
  count: number;
}

const stats: ReplaceStats[] = [];

/**
 * Replace all occurrences of `old` with `replacement` in `file`.
 * Idempotent: skips if `old` is not found (already replaced or not applicable).
 * `file` is relative to the project root.
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
  // Count occurrences before replacing
  const parts = content.split(old);
  const count = parts.length - 1;
  const updated = content.replaceAll(old, replacement);
  writeFileSync(file, updated);
  stats.push({ file, count });
  console.log(`  [OK] ${desc} (${count} occurrence(s))`);
}

/** Check git porcelain and exit if dirty. */
function requireCleanTree(): void {
  const out = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (out) {
    console.error('Error: 工作区有未提交的修改，请先 commit 或 stash。');
    console.error('Uncommitted changes:');
    console.error(out);
    process.exit(1);
  }
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
```

- [ ] **Step 2: Add `customize` npm script**

Add to `package.json` scripts:
```json
"customize": "tsx scripts/customize.ts"
```

- [ ] **Step 3: Verify git check blocks dirty tree**

```bash
echo "test" >> README.md
pnpm customize
```
Expected: Error message about uncommitted changes, exit code 1.
Then: `git checkout -- README.md`

- [ ] **Step 4: Commit**

```bash
git add scripts/customize.ts package.json
git commit -m "feat: add customize.ts skeleton with git check"
```

---

### Task 3: Implement brand name replacements

**Files:**
- Modify: `scripts/customize.ts`

Add the `applyNameReplacements()` function with the full replacement table.

- [ ] **Step 1: Add the LOCALES constant and replacement function**

Insert after the hardcoded values and before `main()`:

```typescript
// Locale files directory
const LOCALES_DIR = 'apps/web/src/i18n/locales';
const LOCALES = [
  'ar', 'de', 'en', 'es-ES', 'fa', 'fr', 'hu', 'id', 'it',
  'ja', 'ko', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'zh-CN', 'zh-TW',
].map(l => `${LOCALES_DIR}/${l}.ts`);

function applyNameReplacements(): void {
  // --- tools/pack constants (exact values from source) ---
  simpleReplace('tools/pack/src/mac/constants.ts',
    'Open Design', NEW_BRAND, 'mac PRODUCT_NAME');
  simpleReplace('tools/pack/src/win/constants.ts',
    'Open Design', NEW_BRAND, 'win PRODUCT_NAME');

  // linux.ts has multiple occurrences
  const linuxFile = 'tools/pack/src/linux.ts';
  simpleReplace(linuxFile, 'Open Design', NEW_BRAND, 'linux PRODUCT_NAME var');
  simpleReplace(linuxFile, 'Open-Design', NEW_KEBAB, 'linux APP_IMAGE_PRODUCT_NAME');
  simpleReplace(linuxFile, 'Open Design Team', `${NEW_BRAND} Team`, 'linux author');
  simpleReplace(linuxFile, 'Open Design Contributors', `${NEW_BRAND} Contributors`, 'linux maintainer');
  simpleReplace(linuxFile, 'Open Design headless launcher', `${NEW_BRAND} headless launcher`, 'linux headless comment');

  // --- i18n locales (19 files × 3 keys) ---
  for (const locale of LOCALES) {
    simpleReplace(locale, "'Open Design'", `'${NEW_BRAND}'`, `i18n app.brand (${locale})`);
    simpleReplace(locale, "'Research Preview'", `'${NEW_BRAND_PILL}'`, `i18n app.brandPill (${locale})`);
    simpleReplace(locale, "'by Nexu Labs'", `'${NEW_BRAND_SUBTITLE}'`, `i18n app.brandSubtitle (${locale})`);
  }

  // --- Prompt files (contracts + daemon mirror — keep in sync) ---
  const promptPairs = [
    { contract: 'packages/contracts/src/prompts/discovery.ts', daemon: 'apps/daemon/src/prompts/discovery.ts' },
    { contract: 'packages/contracts/src/prompts/system.ts', daemon: 'apps/daemon/src/prompts/system.ts' },
    { contract: 'packages/contracts/src/prompts/official-system.ts', daemon: 'apps/daemon/src/prompts/official-system.ts' },
  ];

  for (const { contract, daemon } of promptPairs) {
    simpleReplace(contract, 'Open Design workflow', `${NEW_BRAND} workflow`, `prompt ${contract}`);
    simpleReplace(daemon, 'Open Design workflow', `${NEW_BRAND} workflow`, `prompt ${daemon}`);
    simpleReplace(contract, 'The Open Design UI locale', `The ${NEW_BRAND} UI locale`, `prompt ${contract}`);
    simpleReplace(daemon, 'The Open Design UI locale', `The ${NEW_BRAND} UI locale`, `prompt ${daemon}`);
    simpleReplace(contract, 'Open Design app chrome', `${NEW_BRAND} app chrome`, `prompt ${contract}`);
    simpleReplace(daemon, 'Open Design app chrome', `${NEW_BRAND} app chrome`, `prompt ${daemon}`);
    simpleReplace(contract, 'The base system prompt for Open Design', `The base system prompt for ${NEW_BRAND}`, `prompt ${contract}`);
    simpleReplace(daemon, 'The base system prompt for Open Design', `The base system prompt for ${NEW_BRAND}`, `prompt ${daemon}`);
  }

  // system.ts has additional occurrences (chat mode paragraph, Gemini section, media note)
  for (const sysFile of ['packages/contracts/src/prompts/system.ts', 'apps/daemon/src/prompts/system.ts']) {
    simpleReplace(sysFile, 'Open Design Chat mode', `${NEW_BRAND} Chat mode`, `prompt ${sysFile} chat mode`);
    simpleReplace(sysFile, 'Open Design is the open-source', `${NEW_BRAND} is the open-source`, `prompt ${sysFile} description`);
    simpleReplace(sysFile, 'Open Design agent workflow', `${NEW_BRAND} agent workflow`, `prompt ${sysFile} workflow`);
  }

  // --- Web app ---
  simpleReplace('apps/web/app/layout.tsx', "title: 'Open Design'", `title: '${NEW_BRAND}'`, 'web layout title');
  simpleReplace('packages/contracts/src/api/social-share.ts', 'Built with Open Design', `Built with ${NEW_BRAND}`, 'social-share built-with');
  simpleReplace('packages/contracts/src/api/social-share.ts', "'Open Design project'", `'${NEW_BRAND} project'`, 'social-share fallback');
  simpleReplace('packages/contracts/src/api/social-share.ts', "'Open Design'", `'${NEW_BRAND}'`, 'social-share fallback title');
  simpleReplace('packages/contracts/src/api/social-share.ts', 'Open Design is an open-source workspace', `${NEW_BRAND} is an open-source workspace`, 'social-share og desc');
  simpleReplace('packages/contracts/src/api/social-share.ts', 'Open Design repo:', `${NEW_BRAND} repo:`, 'social-share repo label');

  // --- tools/dev ---
  simpleReplace('tools/dev/src/index.ts', 'Open Design dev server', `${NEW_BRAND} dev server`, 'tools-dev start banner');
  simpleReplace('tools/dev/src/index.ts', 'Stopping Open Design dev server', `Stopping ${NEW_BRAND} dev server`, 'tools-dev stop banner');
}
```

- [ ] **Step 2: Run verify on dry content scan**

```bash
# Verify the locale files have the expected strings before running customize
grep -l "'Open Design'" apps/web/src/i18n/locales/en.ts
grep -l "'Research Preview'" apps/web/src/i18n/locales/en.ts
grep -l "'by Nexu Labs'" apps/web/src/i18n/locales/en.ts
```
Expected: each grep finds the file.

- [ ] **Step 3: Run customize and verify brand name replacements**

```bash
pnpm customize
```
Expected: all brand name replacements execute, no errors.

Then verify:
```bash
grep "Dmas Design" tools/pack/src/mac/constants.ts | head -1
grep "'Dmas Design'" apps/web/src/i18n/locales/en.ts | head -1
grep "Dmas Design" apps/web/app/layout.tsx | head -1
```
Expected: each shows replaced text.

- [ ] **Step 4: Verify idempotency**

```bash
pnpm customize
```
Expected: no replacement output (all skipped as already done).

Then restore:
```bash
pnpm customize:restore
```
Verify clean:
```bash
grep "Open Design" tools/pack/src/mac/constants.ts
```
Expected: shows `"Open Design"` (restored).

- [ ] **Step 5: Commit**

```bash
git add scripts/customize.ts
git commit -m "feat: add brand name replacement rules to customize.ts"
```

---

### Task 4: Implement GitHub URL replacements

**Files:**
- Modify: `scripts/customize.ts`

- [ ] **Step 1: Add the URL replacement function**

Insert `applyUrlReplacements()` before `main()`:

```typescript
function applyUrlReplacements(): void {
  // --- Full GitHub URL ---
  const fullUrlFiles = [
    'packages/contracts/src/api/social-share.ts',
    'apps/web/src/runtime/plugin-source.ts',
    'apps/web/src/components/useGithubStars.ts',
    'apps/web/src/components/EntryHelpMenu.tsx',
    'apps/web/src/components/DesignFilesPanel.tsx',
    'apps/desktop/src/main/index.ts',
  ];
  for (const f of fullUrlFiles) {
    simpleReplace(f, 'https://github.com/nexu-io/open-design', NEW_GITHUB_URL, `github url ${f}`);
  }

  // --- GitHub API URL ---
  simpleReplace('apps/daemon/src/server.ts',
    'https://api.github.com/repos/nexu-io/open-design', NEW_GITHUB_API, 'github api url');

  // --- Short label nexu-io/open-design ---
  // These files use the label form in various contexts (strings, comments, CLI args)
  const labelFiles = [
    // daemon
    'apps/daemon/src/server.ts',
    'apps/daemon/src/cli.ts',
    'apps/daemon/src/plugins/publish.ts',
    'apps/daemon/src/plugins/marketplaces.ts',
    'apps/daemon/src/runtimes/metadata.ts',
    'apps/daemon/src/legacy-data-migrator.ts',
    'apps/daemon/src/import-export-routes.ts',
    'apps/daemon/src/inline-assets.ts',
    'apps/daemon/src/qa/cta-hierarchy.ts',
    'apps/daemon/src/prompts/system.ts',
    // web
    'apps/web/src/runtime/plugin-source.ts',
    'apps/web/src/components/GithubStarBadge.tsx',
    // desktop
    'apps/desktop/src/main/index.ts',
  ];
  for (const f of labelFiles) {
    simpleReplace(f, 'nexu-io/open-design', NEW_GITHUB_LABEL, `github label ${f}`);
  }
}
```

- [ ] **Step 2: Run customize and verify URL replacements**

```bash
pnpm customize
```
Expected: URL replacements execute.

Then verify:
```bash
grep "dmas-studio/dmas-design" apps/daemon/src/server.ts | head -3
grep "dmas-studio/dmas-design" apps/web/src/runtime/plugin-source.ts | head -3
```
Expected: replaced values shown.

- [ ] **Step 3: Restore and commit**

```bash
pnpm customize:restore
git add scripts/customize.ts
git commit -m "feat: add GitHub URL replacement rules to customize.ts"
```

---

### Task 5: Implement Discord conditional hiding

**Files:**
- Modify: `scripts/customize.ts`

This is the most complex part because Discord elements span multiple lines. Each Discord site receives:
1. A constant injection `const __OD_DISCORD = false;` at the top of the file
2. JSX-level conditional wrapping

- [ ] **Step 1: Add helper for constant injection and multiline JSX wrapping**

Insert these two utility functions after `simpleReplace`:

```typescript
/**
 * Inject a constant declaration after the last import statement.
 * Idempotent: checks if the constant already exists.
 */
function injectConst(file: string, constName: string, value: string): void {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    console.warn(`  [WARN] file not found, skipping const inject: ${file}`);
    return;
  }
  if (content.includes(`const ${constName}`)) {
    return; // already injected — idempotent
  }
  // Find the last import line (or 'use client' directive) and inject after it
  const lines = content.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('import ') || line.startsWith('export {') || line.startsWith('//') || line.trim() === '' || line === "'use client';" || line.startsWith("'use")) {
      if (line.startsWith('import ')) lastImportIdx = i;
      continue;
    }
  }
  // Insert after last import
  const insertIdx = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  const injection = `\n// Injected by customize.ts — set to true to re-enable Discord CTAs\nconst ${constName} = ${value};\n`;
  lines.splice(insertIdx, 0, injection);
  writeFileSync(file, lines.join('\n'));
  console.log(`  [OK] injected ${constName} in ${file}`);
}

/**
 * Wrap a JSX block with a conditional guard.
 * Replaces openingAnchor with `{guard && openingAnchor` and
 * replaces closingAnchor with `closingAnchor}`.
 * Only does this if openingAnchor is found and guard doesn't already wrap it.
 */
function wrapJsxBlock(
  file: string,
  openingAnchor: string,
  closingAnchor: string,
  guard: string,
  desc: string,
): void {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    console.warn(`  [WARN] file not found, skipping JSX wrap: ${file}`);
    return;
  }
  // Idempotency: check if already wrapped
  if (content.includes(`{${guard} && ${openingAnchor}`)) {
    return; // already wrapped
  }
  if (!content.includes(openingAnchor)) {
    console.warn(`  [WARN] opening anchor not found in ${file}: "${openingAnchor.substring(0, 60)}..."`);
    return;
  }
  if (!content.includes(closingAnchor)) {
    console.warn(`  [WARN] closing anchor not found in ${file}: "${closingAnchor.substring(0, 60)}..."`);
    return;
  }
  content = content.replace(openingAnchor, `{${guard} && ${openingAnchor}`);
  content = content.replace(closingAnchor, `${closingAnchor}}`);
  writeFileSync(file, content);
  stats.push({ file, count: 1 });
  console.log(`  [OK] ${desc}`);
}

const DISCORD_GUARD = '__OD_DISCORD';
```

- [ ] **Step 2: Add the Discord guard application function**

Insert `applyDiscordGuards()` before `main()`:

```typescript
function applyDiscordGuards(): void {
  // 1. EntryShell.tsx — Discord badge in top bar (lines ~730-749)
  injectConst('apps/web/src/components/EntryShell.tsx', DISCORD_GUARD, 'false');
  wrapJsxBlock(
    'apps/web/src/components/EntryShell.tsx',
    '<a\n                className="entry-discord-badge"',
    '</a>\n              {executionSwitcher}',
    DISCORD_GUARD,
    'EntryShell Discord badge',
  );

  // 2. EntrySettingsMenu.tsx — Discord menu item (lines ~339-364)
  injectConst('apps/web/src/components/EntrySettingsMenu.tsx', DISCORD_GUARD, 'false');
  wrapJsxBlock(
    'apps/web/src/components/EntrySettingsMenu.tsx',
    '<a\n            className="entry-settings-menu__item"\n            href={DISCORD_URL}',
    `<Icon name="external-link" size={12} className="entry-settings-menu__item-end" />\n          </a>`,
    DISCORD_GUARD,
    'EntrySettingsMenu Discord item',
  );

  // 3. EntryHelpMenu.tsx — Discord help menu item (lines ~203-214)
  injectConst('apps/web/src/components/EntryHelpMenu.tsx', DISCORD_GUARD, 'false');
  wrapJsxBlock(
    'apps/web/src/components/EntryHelpMenu.tsx',
    '<a\n            className="entry-help-popover__item"\n            href={DISCORD_URL}',
    `<span>{t('entry.discordLabel')}</span>\n          </a>`,
    DISCORD_GUARD,
    'EntryHelpMenu Discord item',
  );

  // 4. AssistantMessage.tsx — Discord feedback CTAs (lines ~1479-1496, two occurrences)
  injectConst('apps/web/src/components/AssistantMessage.tsx', DISCORD_GUARD, 'false');
  // Replace both <p className="assistant-feedback-discord-note"> blocks
  simpleReplace(
    'apps/web/src/components/AssistantMessage.tsx',
    '<p className="assistant-feedback-discord-note">',
    `{${DISCORD_GUARD} ? <p className="assistant-feedback-discord-note">`,
    'AssistantMessage Discord note (positive)',
  );
  simpleReplace(
    'apps/web/src/components/AssistantMessage.tsx',
    'Discord\n              </a>{" "}\n              community, or drop a screenshot',
    `Discord\n              </a>{" "}\n              community, or drop a screenshot : null}`,
    'AssistantMessage Discord close (positive)',
  );
  simpleReplace(
    'apps/web/src/components/AssistantMessage.tsx',
    'Discord\n              </a>{" "}\n              community',
    `Discord\n              </a>{" "}\n              community : null}`,
    'AssistantMessage Discord close (negative)',
  );

  // 5. useDiscordPresence.ts — early return in hook
  injectConst('apps/web/src/components/useDiscordPresence.ts', DISCORD_GUARD, 'false');
  simpleReplace(
    'apps/web/src/components/useDiscordPresence.ts',
    'export function useDiscordPresence(): CachedPresence | null {\n  const [presence, setPresence]',
    `export function useDiscordPresence(): CachedPresence | null {\n  if (!${DISCORD_GUARD}) return null;\n  const [presence, setPresence]`,
    'useDiscordPresence early return',
  );
}
```

- [ ] **Step 3: Run customize and verify Discord guards**

```bash
pnpm customize
```
Expected: all Discord injections execute.

Verify:
```bash
# Check constant injection
grep "__OD_DISCORD" apps/web/src/components/EntryShell.tsx
grep "__OD_DISCORD" apps/web/src/components/EntrySettingsMenu.tsx
grep "__OD_DISCORD" apps/web/src/components/EntryHelpMenu.tsx
grep "__OD_DISCORD" apps/web/src/components/AssistantMessage.tsx
grep "__OD_DISCORD" apps/web/src/components/useDiscordPresence.ts

# Check JSX wrapping
grep "__OD_DISCORD &&" apps/web/src/components/EntryShell.tsx
grep "if (!__OD_DISCORD)" apps/web/src/components/useDiscordPresence.ts
```
Expected: each check shows the injected content.

- [ ] **Step 4: Restore and commit**

```bash
pnpm customize:restore
git add scripts/customize.ts
git commit -m "feat: add Discord conditional hiding to customize.ts"
```

---

### Task 6: Implement GitHub Star badge replacements

**Files:**
- Modify: `scripts/customize.ts`

- [ ] **Step 1: Add the star replacement function**

Insert `applyStarReplacements()` before `main()`:

```typescript
function applyStarReplacements(): void {
  // Change the repo URL in useGithubStars fetch hook
  simpleReplace(
    "apps/web/src/components/useGithubStars.ts",
    "const REPO = 'https://github.com/nexu-io/open-design'",
    `const REPO = '${NEW_GITHUB_URL}'`,
    'Star badge REPO URL',
  );
  // Change the href in the badge component
  simpleReplace(
    'apps/web/src/components/GithubStarBadge.tsx',
    'nexu-io/open-design',
    NEW_GITHUB_LABEL,
    'Star badge href label',
  );
}
```

- [ ] **Step 2: Run and verify**

```bash
pnpm customize
grep "dmas-studio/dmas-design" apps/web/src/components/useGithubStars.ts
grep "dmas-studio/dmas-design" apps/web/src/components/GithubStarBadge.tsx
```
Expected: both show replaced values.

- [ ] **Step 3: Restore and commit**

```bash
pnpm customize:restore
git add scripts/customize.ts
git commit -m "feat: add GitHub Star badge URL replacement"
```

---

### Task 7: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full customize run**

```bash
pnpm customize
```
Expected: all four sections execute without errors. Output shows ~modified file count and ~occurrence count.

- [ ] **Step 2: TypeCheck passes**

```bash
pnpm typecheck
```
Expected: no new type errors. (The string replacements change values, not types.)

- [ ] **Step 3: guard passes**

```bash
pnpm guard
```
Expected: passes. (No new files without proper structure.)

- [ ] **Step 4: Repeat execution idempotent**

```bash
pnpm customize
pnpm customize
```
Expected: second run shows minimal/no new replacements (all skipped as idempotent).

- [ ] **Step 5: Restore fully cleans**

```bash
pnpm customize:restore
pnpm customize:restore
```
Expected: first restore reverts all files, second restore says "Nothing to restore".

- [ ] **Step 6: Verify all originals restored**

```bash
grep "nexu-io/open-design" apps/daemon/src/server.ts | head -1
grep "Open Design" tools/pack/src/mac/constants.ts | head -1
grep "'Open Design'" apps/web/src/i18n/locales/en.ts | head -1
```
Expected: all show original values.

- [ ] **Step 7: Final customize + dev server quick check**

```bash
pnpm customize
pnpm tools-dev
```
Expected: dev server starts. Open browser at the web URL, check:
- Page title shows "Dmas Design"
- No Discord badge in the top bar
- GitHub Star badge (if visible) points to custom repo

- [ ] **Step 8: Final restore**

```bash
pnpm customize:restore
```

---

## Implementation Order Summary

```
Task 1: customize-restore.ts + npm script     ← safety net
Task 2: customize.ts skeleton (git check)     ← foundation
Task 3: brand name replacements                ← core value
Task 4: GitHub URL replacements                ← core value
Task 5: Discord conditional hiding             ← most complex
Task 6: GitHub Star badge                      ← simplest
Task 7: end-to-end verification                ← gate check
```

Each task is self-contained and can be committed independently. Tasks 1-2 build the framework; Tasks 3-6 each add one category of replacements; Task 7 validates everything together.
