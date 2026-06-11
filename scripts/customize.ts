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
    return; // already injected
  }
  const lines = content.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('import ')) {
      lastImportIdx = i;
    }
  }
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
 * Idempotent: checks if already wrapped.
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
  // Locale files directory
  const LOCALES_DIR = 'apps/web/src/i18n/locales';
  const LOCALES = [
    'ar', 'de', 'en', 'es-ES', 'fa', 'fr', 'hu', 'id', 'it',
    'ja', 'ko', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'zh-CN', 'zh-TW',
  ].map(l => `${LOCALES_DIR}/${l}.ts`);

  // --- tools/pack constants ---
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

  // --- i18n locales (19 files x 3 keys) ---
  for (const locale of LOCALES) {
    simpleReplace(locale, "'Open Design'", `'${NEW_BRAND}'`, `i18n app.brand`);
    simpleReplace(locale, "'Research Preview'", `'${NEW_BRAND_PILL}'`, `i18n app.brandPill`);
    simpleReplace(locale, "'by Nexu Labs'", `'${NEW_BRAND_SUBTITLE}'`, `i18n app.brandSubtitle`);
  }

  // --- Prompt files (contracts + daemon mirror — keep in sync) ---
  const promptPairs = [
    { contract: 'packages/contracts/src/prompts/discovery.ts', daemon: 'apps/daemon/src/prompts/discovery.ts' },
    { contract: 'packages/contracts/src/prompts/system.ts', daemon: 'apps/daemon/src/prompts/system.ts' },
    { contract: 'packages/contracts/src/prompts/official-system.ts', daemon: 'apps/daemon/src/prompts/official-system.ts' },
  ];

  for (const { contract, daemon } of promptPairs) {
    simpleReplace(contract, 'Open Design workflow', `${NEW_BRAND} workflow`, `prompt discovery contract`);
    simpleReplace(daemon, 'Open Design workflow', `${NEW_BRAND} workflow`, `prompt discovery daemon`);
    simpleReplace(contract, 'The Open Design UI locale', `The ${NEW_BRAND} UI locale`, `prompt system contract`);
    simpleReplace(daemon, 'The Open Design UI locale', `The ${NEW_BRAND} UI locale`, `prompt system daemon`);
    simpleReplace(contract, 'Open Design app chrome', `${NEW_BRAND} app chrome`, `prompt official-system contract`);
    simpleReplace(daemon, 'Open Design app chrome', `${NEW_BRAND} app chrome`, `prompt official-system daemon`);
    simpleReplace(contract, 'The base system prompt for Open Design',
      `The base system prompt for ${NEW_BRAND}`, `prompt official-system contract doc`);
    simpleReplace(daemon, 'The base system prompt for Open Design',
      `The base system prompt for ${NEW_BRAND}`, `prompt official-system daemon doc`);
  }

  // system.ts has additional occurrences (chat mode, description, workflow)
  for (const sysFile of ['packages/contracts/src/prompts/system.ts', 'apps/daemon/src/prompts/system.ts']) {
    simpleReplace(sysFile, 'Open Design Chat mode', `${NEW_BRAND} Chat mode`, `prompt system chat mode`);
    simpleReplace(sysFile, 'Open Design is the open-source', `${NEW_BRAND} is the open-source`, `prompt system desc`);
    simpleReplace(sysFile, 'Open Design agent workflow', `${NEW_BRAND} agent workflow`, `prompt system workflow`);
    simpleReplace(sysFile, 'Open Design-owned media', `${NEW_BRAND}-owned media`, `prompt system media note`);
    simpleReplace(sysFile, 'normal Open Design agent workflow',
      `normal ${NEW_BRAND} agent workflow`, `prompt system normal workflow`);
    simpleReplace(sysFile, 'Open Design. Official links', `${NEW_BRAND}. Official links`, `prompt system links`);
  }

  // --- Web app ---
  simpleReplace('apps/web/app/layout.tsx', "title: 'Open Design'", `title: '${NEW_BRAND}'`, 'web layout title');
  simpleReplace('packages/contracts/src/api/social-share.ts',
    'Built with Open Design', `Built with ${NEW_BRAND}`, 'social-share built-with');
  simpleReplace('packages/contracts/src/api/social-share.ts',
    "'Open Design project'", `'${NEW_BRAND} project'`, 'social-share fallback title 1');
  simpleReplace('packages/contracts/src/api/social-share.ts',
    "Open Design'", `${NEW_BRAND}'`, 'social-share fallback title 2');
  simpleReplace('packages/contracts/src/api/social-share.ts',
    'Open Design is an open-source workspace', `${NEW_BRAND} is an open-source workspace`, 'social-share og desc');
  simpleReplace('packages/contracts/src/api/social-share.ts',
    'Open Design repo:', `${NEW_BRAND} repo:`, 'social-share repo label');

  // --- tools/dev ---
  simpleReplace('tools/dev/src/index.ts', 'Open Design dev server', `${NEW_BRAND} dev server`, 'tools-dev start banner');
  simpleReplace('tools/dev/src/index.ts', 'Stopping Open Design dev server',
    `Stopping ${NEW_BRAND} dev server`, 'tools-dev stop banner');
}

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
  const labelFiles = [
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
    'apps/web/src/runtime/plugin-source.ts',
    'apps/web/src/components/GithubStarBadge.tsx',
    'apps/desktop/src/main/index.ts',
  ];
  for (const f of labelFiles) {
    simpleReplace(f, 'nexu-io/open-design', NEW_GITHUB_LABEL, `github label ${f}`);
  }
}

function applyDiscordGuards(): void {
  // 1. EntryShell.tsx — Discord badge in top bar
  injectConst('apps/web/src/components/EntryShell.tsx', DISCORD_GUARD, 'false');
  wrapJsxBlock(
    'apps/web/src/components/EntryShell.tsx',
    '<a\n                className="entry-discord-badge"',
    '</a>\n              {executionSwitcher}',
    DISCORD_GUARD,
    'EntryShell Discord badge',
  );

  // 2. EntrySettingsMenu.tsx — Discord menu item
  injectConst('apps/web/src/components/EntrySettingsMenu.tsx', DISCORD_GUARD, 'false');
  wrapJsxBlock(
    'apps/web/src/components/EntrySettingsMenu.tsx',
    '<a\n            className="entry-settings-menu__item"\n            href={DISCORD_URL}',
    '<Icon name="external-link" size={12} className="entry-settings-menu__item-end" />\n          </a>',
    DISCORD_GUARD,
    'EntrySettingsMenu Discord item',
  );

  // 3. EntryHelpMenu.tsx — Discord help menu item
  injectConst('apps/web/src/components/EntryHelpMenu.tsx', DISCORD_GUARD, 'false');
  wrapJsxBlock(
    'apps/web/src/components/EntryHelpMenu.tsx',
    '<a\n            className="entry-help-popover__item"\n            href={DISCORD_URL}',
    '<span>{t(\'entry.discordLabel\')}</span>\n          </a>',
    DISCORD_GUARD,
    'EntryHelpMenu Discord item',
  );

  // 4. AssistantMessage.tsx — Discord feedback CTAs (two <p> blocks)
  injectConst('apps/web/src/components/AssistantMessage.tsx', DISCORD_GUARD, 'false');
  let amContent: string;
  try {
    amContent = readFileSync('apps/web/src/components/AssistantMessage.tsx', 'utf8');
  } catch {
    console.warn('  [WARN] file not found: AssistantMessage.tsx');
    return;
  }
  // Idempotent: skip if already guarded.
  if (amContent.includes(`{${DISCORD_GUARD} ? <p className="assistant-feedback-discord-note">`)) {
    return;
  }
  // Replace opening tag with ternary guard
  const replaced = amContent.replaceAll(
    '<p className="assistant-feedback-discord-note">',
    `{${DISCORD_GUARD} ? <p className="assistant-feedback-discord-note">`,
  );
  // Replace closing </p> for both the positive and negative feedback branches.
  const updated = replaced
    .replace(
      'Discord</a>{" "}community, or drop a screenshot and tell us what worked well.\n            </p>',
      'Discord</a>{" "}community, or drop a screenshot and tell us what worked well.\n            </p> : null}',
    )
    .replace(
      'Discord</a>{" "}so the team can understand what went wrong and follow up directly.\n            </p>',
      'Discord</a>{" "}so the team can understand what went wrong and follow up directly.\n            </p> : null}',
    );
  if (updated !== amContent) {
    writeFileSync('apps/web/src/components/AssistantMessage.tsx', updated);
    stats.push({ file: 'apps/web/src/components/AssistantMessage.tsx', count: 1 });
    console.log('  [OK] AssistantMessage Discord CTAs');
  }

  // 5. useDiscordPresence.ts — early return in hook
  injectConst('apps/web/src/components/useDiscordPresence.ts', DISCORD_GUARD, 'false');
  simpleReplace(
    'apps/web/src/components/useDiscordPresence.ts',
    'export function useDiscordPresence(): CachedPresence | null {\n  const [presence, setPresence]',
    `export function useDiscordPresence(): CachedPresence | null {\n  if (!${DISCORD_GUARD}) return null;\n  const [presence, setPresence]`,
    'useDiscordPresence early return',
  );
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
