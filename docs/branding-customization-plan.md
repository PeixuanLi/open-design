# Open Design 品牌定制与入口简化 — 实施方案

> 最后更新：2026-06-02
> 
> 核心原则：**脚本化、可重复执行、不修改原始源码**，使仓库可长期接受上游社区更新。

---

## 目录

1. [全局架构](#1-全局架构)
2. [需求一：品牌名替换 + 社区链接替换](#2-需求一品牌名替换--社区链接替换)
3. [需求二：新增预设默认设计风格](#3-需求二新增预设默认设计风格)
4. [需求三：入口简化为仅保留页面原型](#4-需求三入口简化为仅保留页面原型)
5. [需求四：编译期预注入 Memory](#5-需求四编译期预注入-memory)
6. [实施步骤总览](#6-实施步骤总览)

---

## 1. 全局架构

### 1.1 定制化配置文件

在项目根目录创建 `customization.json`，作为所有定制操作的唯一配置源：

```jsonc
// customization.json（提交到你的 fork）
{
  "brand": {
    "productName": "Dmas Design",          // 新应用名
    "brandPill": "Preview",                // 品牌标签
    "brandSubtitle": "by Dmas Studio",     // 副标题
    "appIconBasename": "dmas"              // 图标文件名前缀
  },
  "links": {
    "githubRepo": "https://github.com/dmas-studio/dmas-design",
    "githubRepoApi": "https://api.github.com/repos/dmas-studio/dmas-design",
    "githubRepoLabel": "dmas-studio/dmas-design",
    "githubIssueUrl": "https://github.com/dmas-studio/dmas-design/issues/new",
    "githubReleasesUrl": "https://github.com/dmas-studio/dmas-design/releases",
    "privacyPolicyUrl": "https://github.com/dmas-studio/dmas-design/blob/main/PRIVACY.md",
    "communityUrl": null,                  // null = 禁用 Discord
    "discordEnabled": false
  },
  "entry": {
    "enabledKinds": ["prototype"],         // 仅保留页面原型
    "defaultKind": "prototype",
    "enabledHomeChips": ["prototype"],     // 首页仅原型芯片
    "enabledTabs": ["home", "projects", "design-systems"]  // 导航 Tabs
  },
  "designSystem": {
    "defaultId": "dmas-brand",            // 默认设计系统 ID
    "brandDir": "dmas-brand"              // design-systems/ 下的目录名
  },
  "memory": {
    "docsDir": "docs/memory",             // 预设 memory 文件目录
    "autoSeed": true                      // 编译期自动注入
  },
  "features": {
    "hideGitHubStar": false,              // 隐藏/替换 Star 徽章
    "hideDiscord": true,                  // 隐藏 Discord 入口
    "hideUseEverywhere": true             // 隐藏 "Use Everywhere" 按钮
  }
}
```

### 1.2 脚本体系

```
scripts/customize/
├── apply.ts              # 主编排脚本，读取 customization.json 并调用各子模块
├── rename.ts             # 品牌名替换（字符串替换，不改源码）
├── links.ts              # GitHub/Discord 链接替换
├── design-system.ts      # 设计系统预设
├── strip-entry.ts        # 入口简化
├── memory-seed.ts        # Memory 预注入
└── transforms/
    ├── source-replace.ts # 源码字符串替换工具
    ├── json-merge.ts     # JSON 深度合并工具
    └── i18n-patch.ts     # 18 locale 文件的批量补丁
```

---

## 2. 需求一：品牌名替换 + 社区链接替换

### 2.1 设计原则

**不改动源文件，脚本化替换**。改造脚本在 `pnpm install` 后执行一次（通过 `postinstall` hook 或独立的 `pnpm customize` 命令），将 `Open Design` 相关字符串替换为自定义名称。

**方案一：统一替换源 + 构建期注入（推荐）**

1. 所有硬编码字符串改为从一个统一模块导入
2. 构建期通过脚本替换该模块的默认值
3. 每处代码引用全局搜索到的字符串做精确替换

**方案二：构建前预处理脚本**

1. 编写 `scripts/customize/apply.ts`，读取 `customization.json`
2. 扫描所有需要修改的文件，用正则替换
3. 替换操作在临时工作区或 `git worktree` 中执行
4. 原始源码不受影响

**推荐混合方案**：对已有的硬编码字符串用脚本替换，同时逐步将可配置项抽取到统一模块，方便未来添加新的定制项。

### 2.2 需要替换的字符串清单

#### 2.2.1 产品名 "Open Design" → 新名称

| # | 文件 | 当前文本 | 替换为 | 策略 |
|---|------|---------|--------|------|
| P1 | `apps/web/app/layout.tsx:9` | `title: 'Open Design'` | `title: '{productName}'` | 正则替换 |
| P2 | `tools/pack/src/mac/constants.ts:1` | `PRODUCT_NAME = "Open Design"` | `PRODUCT_NAME = "{productName}"` | 正则替换 |
| P3 | `tools/pack/src/win/constants.ts:1` | `PRODUCT_NAME = "Open Design"` | `PRODUCT_NAME = "{productName}"` | 正则替换 |
| P4 | `tools/pack/src/linux.ts:37-38` | `PRODUCT_NAME = "Open Design"` / `APP_IMAGE_PRODUCT_NAME = "Open-Design"` | 对应替换 | 正则替换 |
| P5 | 18 × locale 文件 `app.brand` | `'Open Design'` | `'{productName}'` | i18n 批量补丁 |
| P6 | 18 × locale 文件 `app.brandPill` | `'Research Preview'` | `'{brandPill}'` | i18n 批量补丁 |
| P7 | 18 × locale 文件 `app.brandSubtitle` | `'by Nexu Labs'` | `'{brandSubtitle}'` | i18n 批量补丁 |
| P8 | `apps/desktop/src/main/index.ts:241` | `label: "Open Design"` | `label: "{productName}"` | 正则替换 |
| P9 | `packages/contracts/src/prompts/discovery.ts:50` | `"Open Design workflow"` | `"{productName} workflow"` | 正则替换 |
| P10 | `apps/daemon/src/prompts/discovery.ts:50` | `"Open Design workflow"` | 同 P9 | 镜像同步 |
| P11 | `packages/contracts/src/prompts/system.ts:72` | `"The Open Design UI locale"` | `"The {productName} UI locale"` | 正则替换 |
| P12 | `apps/daemon/src/prompts/system.ts:66` | 同 P11 | 同 P11 | 镜像同步 |
| P13 | `packages/contracts/src/prompts/official-system.ts:59` | `"Open Design app chrome"` | `"{productName} app chrome"` | 正则替换 |
| P14 | `apps/daemon/src/prompts/official-system.ts:63` | 同 P13 | 同 P13 | 镜像同步 |
| P15 | `packages/contracts/src/api/social-share.ts:165` | `"Built with Open Design"` | `"Built with {productName}"` | 正则替换 |

#### 2.2.2 GitHub URL 替换

| # | 文件 | 当前值 | 替换为 |
|---|------|--------|--------|
| G1 | `packages/contracts/src/api/social-share.ts:1` | `export const OPEN_DESIGN_GITHUB_REPO_URL = 'https://github.com/nexu-io/open-design'` | `{githubRepo}` |
| G2 | `apps/web/src/runtime/plugin-source.ts:52-53` | `OPEN_DESIGN_REPO_URL = 'https://github.com/nexu-io/open-design'` | `{githubRepo}` |
| G3 | `apps/web/src/components/useGithubStars.ts:12` | `REPO = 'https://github.com/nexu-io/open-design'` | `{githubRepo}` |
| G4 | `apps/web/src/components/EntryHelpMenu.tsx:25` | `REPO = 'https://github.com/nexu-io/open-design'` | `{githubRepo}` |
| G5 | `apps/daemon/src/server.ts:3449` | `OPEN_DESIGN_GITHUB_REPO_API = 'https://api.github.com/repos/nexu-io/open-design'` | `{githubRepoApi}` |
| G6 | `apps/daemon/src/plugins/marketplaces.ts:76` | `DEFAULT_MARKETPLACE_REPO = 'nexu-io/open-design'` | `{githubRepoLabel}` |
| G7 | `apps/daemon/src/server.ts:1399` | `OFFICIAL_PLUGIN_SOURCE_REPO = 'github:nexu-io/open-design@main'` | `'github:{githubRepoLabel}@main'` |
| G8 | `apps/daemon/src/cli.ts:3818,3850,4162` | 多处 `nexu-io/open-design` | `{githubRepoLabel}` |
| G9 | `apps/daemon/src/plugins/publish.ts:155` | `newIssueUrl('nexu-io/open-design',...)` | `newIssueUrl('{githubRepoLabel}',...)` |
| G10 | `apps/desktop/src/main/index.ts:264,277` | `nexu-io/open-design#readme` / `nexu-io/open-design/issues/new` | 对应 URL |
| G11 | `apps/web/src/components/SettingsDialog.tsx:1241` | `nexu-io/open-design/releases` | `{githubReleasesUrl}` |
| G12 | `apps/web/src/components/PrivacyConsentModal.tsx:11` | `PRIVACY_POLICY_URL` | `{privacyPolicyUrl}` |
| G13 | `apps/web/src/components/PromptTemplatesTab.tsx:18` | `'nexu-io/open-design': 'Open Design'` | 对应替换 |
| G14 | `apps/web/src/components/home-hero/plugin-authoring.ts:41` | `nexu-io/open-design` | `{githubRepoLabel}` |
| G15 | `apps/web/src/components/design-files/pluginFolderActions.ts:40` | `nexu-io/open-design` | `{githubRepoLabel}` |
| G16 | `apps/web/src/components/share-to-community/shareToCommunityPrompt.ts:31` | `nexu-io/open-design` | `{githubRepoLabel}` |
| G17 | `apps/daemon/src/runtimes/metadata.ts:8,31` | `nexu-io/open-design` | `{githubRepoLabel}` |
| G18 | `apps/packaged/src/sidecars.ts:156` | 注释中的 `nexu-io/open-design` | `{githubRepoLabel}` |
| G19 | `apps/daemon/src/legacy-data-migrator.ts:14,40` | 注释/文档 URL | `{githubRepoLabel}` |
| G20 | `apps/daemon/src/import-export-routes.ts:540-541` | 注释/问题链接 | `{githubRepoLabel}` |

#### 2.2.3 Discord 删除/隐藏

删除策略：通过条件编译/环境变量控制是否渲染 Discord 相关组件。

| # | 文件 | 操作 | 方法 |
|---|------|------|------|
| D1 | `apps/web/src/components/EntryShell.tsx:159,436-717` | 隐藏 Discord 徽章 | `if (!cfg.discordEnabled) return null` |
| D2 | `apps/web/src/components/EntrySettingsMenu.tsx:26,69-243` | 隐藏 Discord 菜单项 | 同上 |
| D3 | `apps/web/src/components/EntryHelpMenu.tsx:31,205-213` | 隐藏 Discord 帮助项 | 同上 |
| D4 | `apps/web/src/components/AssistantMessage.tsx:82,1561-1578` | 隐藏反馈 Discord CTA | 同上 |
| D5 | `apps/web/src/components/useDiscordPresence.ts` | 整个 Hook 返回 null | 提前 return null |
| D6 | `apps/daemon/src/server.ts` 中的 `/api/community/discord` | 不加载路由 | 条件注册 |
| D7 | 18 × locale 文件 `entry.discord*` keys | 保留不动，UI 隐藏即可 | 无需修改源码 |

#### 2.2.4 GitHub Star 徽章 URL 替换

| # | 文件 | 操作 |
|---|------|------|
| S1 | `apps/web/src/components/useGithubStars.ts:12` | REPO 改为用户 GitHub URL |
| S2 | `apps/web/src/components/GithubStarBadge.tsx` | href 指向用户 Repo URL |

### 2.3 脚本实现

`scripts/customize/rename.ts` 核心逻辑：

```typescript
// 伪代码
import { readFileSync, writeFileSync } from 'node:fs';

interface Replacement {
  file: string;
  pattern: RegExp | string;
  replacement: string;
  description: string;
}

function applyReplacements(replacements: Replacement[]): void {
  for (const r of replacements) {
    const content = readFileSync(r.file, 'utf8');
    const updated = content.replace(r.pattern, r.replacement);
    if (updated !== content) {
      writeFileSync(r.file, updated);
      console.log(`✓ ${r.description}`);
    }
  }
}

function customizeBrand(config: CustomizationConfig): void {
  const replacements: Replacement[] = [
    // 产品名
    { file: 'apps/web/app/layout.tsx', pattern: /Open Design/g, replacement: config.brand.productName },
    // GitHub URL
    { file: 'packages/contracts/src/api/social-share.ts', pattern: /https:\/\/github\.com\/nexu-io\/open-design/g, replacement: config.links.githubRepo },
    // ... 更多
  ];
  applyReplacements(replacements);
}
```

**关键设计**：
- 所有替换通过 `sed` 等价的正则替换执行，不依赖 AST 解析
- 每次运行都是幂等的（替换后的文本不应再次被匹配）
- 替换前后做 diff 校验，确保只修改了预期的行

---

## 3. 需求二：新增预设默认设计风格

### 3.1 方案

在 `design-systems/` 下创建你的品牌目录，包含完整的 `DESIGN.md`、`tokens.css`、`components.html` 和 `manifest.json`。同时在 daemon 启动时将该设计系统设为默认。

### 3.2 文件清单

创建以下目录和文件：

```
design-systems/dmas-brand/
├── manifest.json          # 元信息
├── DESIGN.md              # 核心设计规范（AI 可直接读取）
├── tokens.css             # CSS 变量（可选但推荐）
├── components.html        # 组件预览（可选）
├── assets/                # 品牌资源（可选）
│   ├── logo.svg
│   ├── logo.png
│   └── favicon.ico
└── preview/               # 预览页面（可选）
    ├── colors-primary.html
    └── typography-specimens.html
```

### 3.3 manifest.json

```json
{
  "schemaVersion": "od-design-system-project/v1",
  "id": "dmas-brand",
  "name": "Dmas Design System",
  "category": "Brand Identity",
  "description": "Default design system for Dmas Design projects — clean, modern, professional.",
  "files": {
    "design": "DESIGN.md",
    "tokens": "tokens.css",
    "components": "components.html"
  },
  "assetsDir": "assets",
  "previewDir": "preview",
  "surface": "web",
  "importMode": "normalized"
}
```

### 3.4 DESIGN.md 模板示例

```markdown
# Dmas Design System

## Brand & Voice
- **Tone**: Professional, modern, approachable
- **Audience**: Product designers, engineers, founders
- **Key values**: Clarity, efficiency, craft

## Visual System

### Color Palette
| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#2563EB` | CTAs, links, active states |
| Primary Dark | `#1D4ED8` | Hover states |
| Secondary | `#7C3AED` | Accents, badges |
| Background | `#FAFAFA` | Page background |
| Surface | `#FFFFFF` | Cards, modals |
| Text Primary | `#111827` | Headings, body |
| Text Secondary | `#6B7280` | Captions, metadata |
| Border | `#E5E7EB` | Dividers, inputs |

### Typography
- **Headings**: Inter, weight 700
- **Body**: Inter, weight 400
- **Code**: JetBrains Mono
- **Scale**: 12/14/16/18/20/24/28/36/48px

### Spacing
- **Unit**: 4px
- **Scale**: 4, 8, 12, 16, 24, 32, 48, 64, 96px

### Border Radius
- **Small**: 6px (buttons, inputs)
- **Medium**: 12px (cards, modals)
- **Large**: 16px (containers)

### Shadows
- **Card**: 0 1px 3px rgba(0,0,0,0.1)
- **Modal**: 0 4px 24px rgba(0,0,0,0.12)
- **Dropdown**: 0 2px 8px rgba(0,0,0,0.08)
```

### 3.5 tokens.css 示例

```css
:root {
  --color-primary: #2563EB;
  --color-primary-dark: #1D4ED8;
  --color-secondary: #7C3AED;
  --color-background: #FAFAFA;
  --color-surface: #FFFFFF;
  --color-text-primary: #111827;
  --color-text-secondary: #6B7280;
  --color-border: #E5E7EB;
  --font-heading: 'Inter', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --space-unit: 4px;
}
```

### 3.6 设定为默认设计系统

**方式一：环境变量**（不改源码）

```bash
export OD_DEFAULT_DESIGN_SYSTEM=dmas-brand
```

在 `apps/daemon/src/server.ts` 现存逻辑中已有 `defaultDesignSystemId` 的支持，如果上游已支持环境变量覆盖则无需额外修改。

**方式二：脚本改写 daemon 默认值**（需确认上游支持）

在 `scripts/customize/design-system.ts` 中定位 daemon 启动配置，写入默认设计系统 ID。

**方式三：daemon 启动参数**

如果 daemon 支持 CLI 参数 `--default-design-system dmas-brand`，在打包启动脚本中添加。

### 3.7 定制 DESIGN.md 的 AI 合成模板（可选深度定制）

如需让 AI 的 Finalize Design 功能按你的模板结构生成 DESIGN.md，修改 `apps/daemon/src/finalize-design.ts` 中的 `SYSTEM_PROMPT` 常量。这属于**深度定制**，需要权衡是否值得维护这个 diff。

---

## 4. 需求三：入口简化为仅保留页面原型

### 4.1 修改范围

需要修改 4 个关键入口点，通过脚本化的条件控制来精简。

### 4.2 首页芯片 (Home Hero Chips)

**文件**：`apps/web/src/components/home-hero/chips.ts:72-226`

**当前**：10 个 chips（prototype, deck, hyperframes, live-artifact, image, video, audio, create-plugin, figma, template）

**目标**：仅保留 `prototype`

**修改方案**：在这个文件顶部添加一个过滤函数，通过环境变量控制：

```typescript
// 在 chips.ts 中添加
const ENABLED_CHIPS = (process.env.OD_ENABLED_HOME_CHIPS || 'prototype').split(',');

export const HOME_HERO_CHIPS: ReadonlyArray<HomeHeroChip> = ALL_HOME_HERO_CHIPS.filter(
  (chip) => ENABLED_CHIPS.includes(chip.id)
);
```

脚本 `scripts/customize/strip-entry.ts` 在构建前：
1. 读取 `customization.json` → `entry.enabledHomeChips`
2. 修改 chips.ts，在文件末尾添加过滤逻辑

### 4.3 新建项目面板 (NewProjectPanel)

**文件**：`apps/web/src/components/NewProjectPanel.tsx:112`

**当前**：`CreateTab = 'prototype' | 'live-artifact' | 'deck' | 'template' | 'media' | 'other'`

**目标**：仅 `'prototype'`

**修改方案**：

1. 修改 `CreateTab` 类型为仅 `'prototype'`
2. 移除 `TAB_LABEL_KEYS` 中的其他条目
3. Tab 渲染循环中跳过不在白名单中的 tab
4. 或者：在所有 `CreateTab` 相关逻辑中，通过运行时过滤

**脚本化方式**：在 `NewProjectPanel.tsx` 顶部注入一个常量：

```typescript
// 注入行：由 scripts/customize/strip-entry.ts 维护
const ENABLED_TABS: Set<string> = new Set(['prototype']);
```

然后在渲染 Tab 按钮和表单时添加过滤：

```typescript
// 原始：渲染所有 TAB_LABEL_KEYS 的 tab
// 修改后：
{Object.entries(TAB_LABEL_KEYS)
  .filter(([key]) => ENABLED_TABS.has(key))
  .map(([key, labelKey]) => renderTab(key, labelKey))}
```

### 4.4 导航栏 (EntryNavRail)

**文件**：`apps/web/src/components/EntryNavRail.tsx`

**当前** 6 个导航项：Home, Projects, Automations, Plugins, Design Systems, Integrations

**目标**：保留 Home, Projects, Design Systems

**修改方案**：添加过滤逻辑：

```typescript
const ENABLED_NAV_TABS = new Set(['home', 'projects', 'design-systems']);
// 在渲染时过滤
```

### 4.5 入口 Shell (EntryShell)

**文件**：`apps/web/src/components/EntryShell.tsx`

关键修改点：

| 行号 | 修改 | 说明 |
|------|------|------|
| L143-215 | `defaultPluginInputsForCreate()` | 仅保留 prototype 分支 |
| L408 | `useState<CreateTab>('prototype')` | 默认 tab 已在 prototype，无需改 |
| L550-571 | onboarding view 分支 | 如果预设了 provider，可跳过 |
| L702-717 | Discord 徽章 | 条件隐藏 |
| L584 | `GithubStarBadge` | 替换 href URL |

### 4.6 脚本实现

`scripts/customize/strip-entry.ts` 核心逻辑：

```typescript
// 伪代码
function stripEntry(config: CustomizationConfig): void {
  const { enabledKinds, enabledHomeChips, enabledTabs } = config.entry;
  
  // 1. 注入 chips 过滤
  injectFilter('apps/web/src/components/home-hero/chips.ts', 'HOME_HERO_CHIPS', enabledHomeChips);
  
  // 2. 注入 NewProjectPanel tab 过滤
  injectTabFilter('apps/web/src/components/NewProjectPanel.tsx', 'CreateTab', enabledKinds);
  
  // 3. 注入导航过滤
  injectNavFilter('apps/web/src/components/EntryNavRail.tsx', 'EntryView', enabledTabs);
  
  // 4. 隐藏 Discord（通过条件编译）
  injectFeatureFlag('apps/web/src/components/EntryShell.tsx', 'discordEnabled', false);
  
  // 5. 恢复函数：将所有修改 revert
  writeRestoreScript();
}
```

**关键**：每次修改前备份原始内容，并生成 `scripts/customize/restore.ts` 用于恢复。

---

## 5. 需求四：编译期预注入 Memory

### 5.1 Memory 系统原理

Open Design 的 Memory 机制：

```
<dataDir>/memory/           ← daemon 管理的运行期目录
├── MEMORY.md               ← 索引文件，每行一个事实链接
├── user_<slug>.md          ← 用户类型记忆
├── feedback_<slug>.md      ← 反馈类型记忆
├── project_<slug>.md       ← 项目类型记忆
├── reference_<slug>.md     ← 参考类型记忆
└── .config.json            ← { "enabled": true, "chatExtractionEnabled": true }
```

**核心函数**（`apps/daemon/src/memory.ts`）：
- `upsertMemoryEntry(dataDir, { name, description, type, body })` — 写入 .md 文件 + 更新 MEMORY.md
- `composeMemoryBody(dataDir)` — 读取 MEMORY.md 的活跃条目，组装为系统提示词注入
- `readMemoryIndex(dataDir)` / `writeMemoryIndex(dataDir, body)` — 读写索引

**文件格式**：
```markdown
---
name: Dmas Design 设计原则
description: Dmas Design 遵循极简专业风格
type: reference
---

Dmas Design 的设计原则：
1. 简洁至上 — 每个界面元素都有明确目的
2. 专业感 — 配色克制，排版精准
3. 高效 — 减少决策成本，快速产出
```

**MEMORY.md 格式**：
```markdown
# Memory

This is your auto-memory index...

- [Dmas Design 设计原则](reference_dmas_design_principles.md) — Dmas Design 遵循极简专业风格
```

### 5.2 方案

在 `docs/memory/` 目录下放置 `.md` 文件（每文件一条记忆），编译期脚本将这些文件注入到 daemon 的 memory 目录。

### 5.3 文件格式约定

```
docs/memory/
├── reference_dmas_design_principles.md
├── reference_dmas_color_usage.md
├── reference_dmas_typography.md
├── reference_dmas_common_patterns.md
├── project_dmas_project_template.md
└── user_dmas_user_context.md
```

**文件名规则**：`{type}_{slug}.md`
- `type` ∈ {user, feedback, project, reference}
- `slug`：小写字母+数字+下划线

**文件内容格式**：

```markdown
---
name: <显示名称>
description: <一行描述，用于 MEMORY.md 和系统提示词>
type: <user|feedback|project|reference>
---

<markdown 正文 — 会被注入到系统提示词中>
```

### 5.4 Memory 注入时机

| 时机 | 方法 | 适用场景 |
|------|------|----------|
| **A. daemon 首次启动时** | 在 daemon 初始化阶段检查 memory 目录是否为空，为空则从 `docs/memory/` 复制 | 开发环境、用户本地安装 |
| **B. 打包时注入** | 打包脚本将 memory 文件复制到打包产物的默认 dataDir | 分发版本 |
| **C. 构建期预处理** | 构建时将 `docs/memory/` 编译为 JSON，嵌入 daemon bundle | 最完整的集成 |

**推荐方案 A**，兼顾灵活性和可控性：

在 daemon 启动逻辑中添加：

```typescript
// apps/daemon/src/server.ts 的 startServer 中
async function seedDefaultMemories(dataDir: string): Promise<void> {
  const memDir = memoryDir(dataDir);
  const existing = await listMemoryEntries(dataDir);
  if (existing.length > 0) return; // 已有记忆，不覆盖
  
  const seedDir = path.join(projectRoot, 'docs', 'memory');
  let files: string[];
  try {
    files = await fsp.readdir(seedDir);
  } catch { return; }
  
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const raw = await fsp.readFile(path.join(seedDir, file), 'utf8');
    const { data: fm, body } = parseFrontmatter(raw);
    if (!fm.name || !fm.type) continue;
    
    const id = file.replace(/\.md$/, '');
    await upsertMemoryEntry(dataDir, {
      id,
      name: String(fm.name),
      description: String(fm.description || ''),
      type: String(fm.type),
      body,
    }, { silent: true });
  }
  
  emitChange({ kind: 'config', enabled: true, at: Date.now() });
}
```

### 5.5 脚本化方案

如果不想修改 daemon 源码，可以通过 `scripts/customize/memory-seed.ts` 实现编译期注入：

```typescript
// scripts/customize/memory-seed.ts
function seedMemoryAtBuild(config: CustomizationConfig): void {
  const seedDir = config.memory.docsDir; // 'docs/memory'
  const files = readdirSync(seedDir).filter(f => f.endsWith('.md'));
  
  // 方案 A: 生成一个 JSON 文件嵌入 daemon bundle
  const memories = files.map(f => parseMemoryFile(path.join(seedDir, f)));
  writeFileSync(
    'apps/daemon/src/generated/memory-seed.json',
    JSON.stringify(memories, null, 2)
  );
  
  // 同时更新 MEMORY.md 索引模板
  generateMemoryIndex(memories, 'apps/daemon/src/generated/memory-index.md');
}
```

然后修改 `apps/daemon/src/memory.ts` 的 `readMemoryIndex`，当 `MEMORY.md` 不存在时返回预设的索引模板。

---

## 6. 实施步骤总览

### 第一步：准备定制化配置

```bash
# 1. 创建定制化配置（在项目根目录）
cp customization.example.json customization.json
# 编辑 customization.json，填入品牌名、URL、启用的功能等

# 2. 创建预设设计系统
mkdir -p design-systems/dmas-brand/{assets,preview}
# 编写 DESIGN.md, tokens.css, components.html, manifest.json

# 3. 创建预设 Memory 文件
mkdir -p docs/memory
# 在 docs/memory/ 中创建 .md 文件，每条一个设计原则/品牌规范

# 4. 替换图标资源
# 将你的 dmas-logo.svg, dmas-logo.png, dmas-icon.png 等放到
# apps/web/public/ 下，覆盖原文件
```

### 第二步：运行定制化脚本

```bash
# 运行品牌定制脚本（在 pnpm install 后执行）
pnpm customize

# 该命令会：
# 1. 替换所有 "Open Design" 字符串为 "Dmas Design"
# 2. 替换所有 GitHub URL 为你的 Repo URL
# 3. 隐藏 Discord 入口
# 4. 精简首页/新建面板为仅保留 Prototype
# 5. 生成 memory seed JSON
```

### 第三步：验证

```bash
# 类型检查
pnpm typecheck

# 项目检查
pnpm guard

# 启动开发环境
pnpm tools-dev

# 打包验证
pnpm tools-pack mac build --to all
```

### 第四步：维护上游更新

```bash
# 拉取上游更新
git fetch upstream
git merge upstream/main

# 解决冲突后重新运行定制化
pnpm customize

# 重新验证
pnpm typecheck && pnpm guard
```

---

## 附录

### A. 全部修改清单（按文件）

| 文件 | 修改类型 | 脚本化 |
|------|----------|--------|
| `customization.json` | 新建 | — |
| `scripts/customize/apply.ts` | 新建 | — |
| `scripts/customize/rename.ts` | 新建 | ✓ |
| `scripts/customize/links.ts` | 新建 | ✓ |
| `scripts/customize/design-system.ts` | 新建 | ✓ |
| `scripts/customize/strip-entry.ts` | 新建 | ✓ |
| `scripts/customize/memory-seed.ts` | 新建 | ✓ |
| `docs/memory/*.md` | 新建 | — |
| `design-systems/dmas-brand/*` | 新建 | — |
| `apps/web/public/app-icon.svg` | 替换 | — |
| `apps/web/public/app-icon.png` | 替换 | — |
| `apps/web/public/logo.svg` | 替换 | — |
| `apps/web/public/logo.png` | 替换 | — |
| `apps/web/public/brand-icon.svg` | 替换 | — |
| `apps/web/public/favicon.ico` | 替换 | — |
| `packages/contracts/src/api/social-share.ts` | URL 替换 | ✓ |
| `packages/contracts/src/prompts/discovery.ts` | 产品名 | ✓ |
| `packages/contracts/src/prompts/system.ts` | 产品名 | ✓ |
| `packages/contracts/src/prompts/official-system.ts` | 产品名 | ✓ |
| `apps/daemon/src/prompts/discovery.ts` | 产品名 | ✓ |
| `apps/daemon/src/prompts/system.ts` | 产品名 | ✓ |
| `apps/daemon/src/prompts/official-system.ts` | 产品名 | ✓ |
| `apps/web/app/layout.tsx` | title | ✓ |
| `apps/web/src/runtime/plugin-source.ts` | URL 替换 | ✓ |
| `apps/web/src/components/useGithubStars.ts` | URL 替换 | ✓ |
| `apps/web/src/components/GithubStarBadge.tsx` | URL 替换 | ✓ |
| `apps/web/src/components/EntryShell.tsx` | Discord 隐藏 + URL | ✓ |
| `apps/web/src/components/EntrySettingsMenu.tsx` | Discord 隐藏 + URL | ✓ |
| `apps/web/src/components/EntryHelpMenu.tsx` | Discord 隐藏 + URL | ✓ |
| `apps/web/src/components/EntryNavRail.tsx` | Tab 过滤 | ✓ |
| `apps/web/src/components/NewProjectPanel.tsx` | Tab 过滤 | ✓ |
| `apps/web/src/components/home-hero/chips.ts` | Chip 过滤 | ✓ |
| `apps/web/src/components/HomeView.tsx` | Chip 过滤 | ✓ |
| `apps/web/src/components/AssistantMessage.tsx` | Discord CTA 隐藏 | ✓ |
| `apps/web/src/components/useDiscordPresence.ts` | 提前返回 null | ✓ |
| `apps/desktop/src/main/index.ts` | 菜单标签 + URL | ✓ |
| `apps/daemon/src/server.ts` | Discord 路由 + URL | ✓ |
| `apps/daemon/src/cli.ts` | URL 替换 | ✓ |
| `apps/daemon/src/plugins/publish.ts` | URL 替换 | ✓ |
| `apps/daemon/src/plugins/marketplaces.ts` | URL 替换 | ✓ |
| `apps/daemon/src/runtimes/metadata.ts` | URL 替换 | ✓ |
| `18 × locale files` | app.brand 等 key 值 | ✓ |
| `tools/pack/src/mac/constants.ts` | PRODUCT_NAME | ✓ |
| `tools/pack/src/win/constants.ts` | PRODUCT_NAME | ✓ |
| `tools/pack/src/linux.ts` | PRODUCT_NAME | ✓ |

### B. 风险与注意事项

1. **Prompt 文件同步**：`packages/contracts/src/prompts/` 和 `apps/daemon/src/prompts/` 必须始终保持同步，脚本需要同时修改两处。
2. **i18n 文件数量**：18 个 locale 文件需要批量更新，脚本必须处理所有语言文件。
3. **上游合并冲突**：脚本修改的文件如果和上游更新冲突，需要手动解决后再运行定制化脚本。
4. **类型安全**：`CreateTab` 类型变更会影响多处类型推断，必须保证 `pnpm typecheck` 通过。
5. **桌面打包验证**：Windows 的 NSIS 安装器会根据 `PRODUCT_NAME` 创建注册表键，测试时需清理旧安装。
6. **Memory 不覆盖**：如果用户已有 memory 条目，不应覆盖，只在 memory 为空时才 seeding。
