# 需求一：品牌名替换 + 社区链接替换 — 设计文档

> 日期：2026-06-12
> 父文档：`docs/branding-customization-plan.md`

## 1. 目标和范围

将 Open Design 中的所有品牌名（`Open Design`）、GitHub 链接（`nexu-io/open-design`）、Discord 入口替换为用户指定的值，通过构建前脚本做文本替换，不修改提交的源码。

### 范围

| 项目 | 说明 |
|------|------|
| 品牌名 | `Open Design` → 用户指定名称（如 `Dmas Design`） |
| 品牌标签 | `Research Preview` → 用户指定标签 |
| 副标题 | `by Nexu Labs` → 用户指定副标题 |
| GitHub URL | `github.com/nexu-io/open-design` → 用户仓库 URL |
| GitHub API | `api.github.com/repos/nexu-io/open-design` → 用户仓库 API |
| GitHub 短线引用 | `nexu-io/open-design` → 用户 `org/repo` |
| Discord | 条件隐藏（UI 不渲染），不做 DEAD CODE 删除 |
| 桌面打包 | 覆盖所有 `tools/pack` 下的 `PRODUCT_NAME` |

## 2. 执行流程

```
源码（干净，与上游一致）
     │
     ├── pnpm customize         ← 手动执行，做文本替换
     │        │
     │        ├─ 1. git status --porcelain（有未提交 → 退出）
     │        ├─ 2. 品牌名替换
     │        ├─ 3. GitHub URL 替换
     │        └─ 4. Discord 条件隐藏注入
     │
     ├── pnpm tools-dev          ← 开发启动
     ├── pnpm tools-pack build   ← 打包
     │
     └── pnpm customize:restore  ← 手动还原（git checkout 修改过的文件）
```

## 3. 核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 配置管理 | 硬编码在脚本中 | 最简单，只定制一个品牌 |
| 执行方式 | 手动 `pnpm customize` | 显式操作，不会意外触发 |
| 未提交检查 | 有未提交内容时拒绝执行 | 保护未保存工作，方便 git restore |
| 幂等性 | 每次替换前检查源字符串是否存在 | 重复执行不产生错误 |
| 可恢复 | `pnpm customize:restore` = git checkout | 利用 git 本身的还原能力 |
| Discord 隐藏 | JSX 处包裹条件渲染 | 简单可靠，不需要解析函数边界 |

## 4. 文件结构

```
scripts/
├── customize.ts          # 主编排脚本
└── customize-restore.ts  # 恢复脚本（git checkout 所有修改过的文件）
```

两个根级 npm scripts：

```json
{
  "scripts": {
    "customize": "tsx scripts/customize.ts",
    "customize:restore": "tsx scripts/customize-restore.ts"
  }
}
```

## 5. `scripts/customize.ts` 实现

### 5.1 入口逻辑

```
main():
  1. 执行 git status --porcelain
     - 非空 → 输出 "Error: 工作区有未提交的修改，请先 commit 或 stash。" → exit(1)
  2. Run 品牌名替换
  3. Run GitHub URL 替换
  4. Run Discord 条件隐藏注入
  5. Run GitHub Star 徽章替换
  6. 打印统计摘要
```

### 5.2 品牌名替换

精确字符串替换（非正则，保证不会误匹配）：

```typescript
// 硬编码的替换规则
const NAME_REPLACEMENTS = [
  // tools/pack 打包常量
  { file: 'tools/pack/src/mac/constants.ts',    old: 'Open Design',     new: 'Dmas Design' },
  { file: 'tools/pack/src/win/constants.ts',    old: 'Open Design',     new: 'Dmas Design' },
  { file: 'tools/pack/src/linux.ts',            old: 'Open Design',     new: 'Dmas Design' },
  { file: 'tools/pack/src/linux.ts',            old: 'Open-Design',     new: 'Dmas-Design' },
  { file: 'tools/pack/src/linux.ts',            old: 'Open Design Team',new: 'Dmas Design Team' },
  { file: 'tools/pack/src/linux.ts',            old: 'Open Design Contributors', new: 'Dmas Design Contributors' },

  // i18n: 19 个 locale 文件
  ...LOCALES.map(f => ({ file: f, old: "'Open Design'",      new: "'Dmas Design'" })),
  ...LOCALES.map(f => ({ file: f, old: "'Research Preview'", new: "'Preview'" })),
  ...LOCALES.map(f => ({ file: f, old: "'by Nexu Labs'",    new: "'by Dmas Studio'" })),

  // Prompt 文件（contracts + daemon 镜像）
  { file: 'packages/contracts/src/prompts/discovery.ts',        old: 'Open Design workflow', new: 'Dmas Design workflow' },
  { file: 'apps/daemon/src/prompts/discovery.ts',               old: 'Open Design workflow', new: 'Dmas Design workflow' },
  { file: 'packages/contracts/src/prompts/system.ts',           old: 'The Open Design UI locale', new: 'The Dmas Design UI locale' },
  { file: 'apps/daemon/src/prompts/system.ts',                  old: 'The Open Design UI locale', new: 'The Dmas Design UI locale' },
  { file: 'packages/contracts/src/prompts/official-system.ts',  old: 'Open Design app chrome', new: 'Dmas Design app chrome' },
  { file: 'apps/daemon/src/prompts/official-system.ts',         old: 'Open Design app chrome', new: 'Dmas Design app chrome' },

  // Web app
  { file: 'apps/web/app/layout.tsx',             old: 'Open Design', new: 'Dmas Design' },
  { file: 'packages/contracts/src/api/social-share.ts', old: 'Built with Open Design', new: 'Built with Dmas Design' },

  // Desktop
  { file: 'apps/desktop/src/main/index.ts',      old: 'Open Design', new: 'Dmas Design' },

  // 其他
  { file: 'tools/dev/src/index.ts',              old: 'Open Design', new: 'Dmas Design' },
];
```

**LOCALES** = `apps/web/src/i18n/locales/` 下的所有 `.ts` 文件（当前 19 个：`ar`, `de`, `en`, `es-ES`, `fa`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `pl`, `pt-BR`, `ru`, `th`, `tr`, `uk`, `zh-CN`, `zh-TW`）。

### 5.3 GitHub URL 替换

```typescript
const URL_REPLACEMENTS = [
  // 完整 URL 替换
  { file: 'packages/contracts/src/api/social-share.ts',
    old: 'https://github.com/nexu-io/open-design',
    new: 'https://github.com/dmas-studio/dmas-design' },
  { file: 'apps/web/src/runtime/plugin-source.ts',
    old: 'https://github.com/nexu-io/open-design',
    new: 'https://github.com/dmas-studio/dmas-design' },
  { file: 'apps/web/src/components/useGithubStars.ts',
    old: 'https://github.com/nexu-io/open-design',
    new: 'https://github.com/dmas-studio/dmas-design' },
  { file: 'apps/web/src/components/EntryHelpMenu.tsx',
    old: 'https://github.com/nexu-io/open-design',
    new: 'https://github.com/dmas-studio/dmas-design' },

  // API URL
  { file: 'apps/daemon/src/server.ts',
    old: 'https://api.github.com/repos/nexu-io/open-design',
    new: 'https://api.github.com/repos/dmas-studio/dmas-design' },

  // 短线引用 nexu-io/open-design（精确匹配，避免替换其他 repo 引用）
  ...globFiles('apps/daemon/src/**/*.ts', 'apps/web/src/**/*.tsx', 'apps/desktop/src/**/*.ts')
    .map(f => ({ file: f, old: 'nexu-io/open-design', new: 'dmas-studio/dmas-design' })),
];
```

### 5.4 Discord 条件隐藏

在文件顶部注入一个常量 `const __OD_DISCORD = false;`，然后在 JSX 使用处包裹条件渲染。

```typescript
const DISCORD_WRAPS = [
  {
    file: 'apps/web/src/components/EntryShell.tsx',
    wraps: ['<DiscordBadge'],
  },
  {
    file: 'apps/web/src/components/EntrySettingsMenu.tsx',
    wraps: ['discord'],
  },
  {
    file: 'apps/web/src/components/EntryHelpMenu.tsx',
    wraps: ['Discord'],
  },
  {
    file: 'apps/web/src/components/AssistantMessage.tsx',
    wraps: ['Discord'],
  },
  {
    file: 'apps/web/src/components/useDiscordPresence.ts',
    // 整个函数体替换为 return null（因为 discord 未启用）
  },
];
```

注入逻辑：

1. 检查文件是否已有 `__OD_DISCORD` 常量，没有则在第一个 import 之后插入 `const __OD_DISCORD = false;`
2. 对每个 `wraps` 条目，找到包含该字符串的 JSX 标签行，替换为：
   - `<DiscordBadge ... />` → `{__OD_DISCORD ? <DiscordBadge ... /> : null}` （注意 JSX 自闭合和多行的处理）
   - `useDiscordPresence.ts`：在函数体开头插入 `if (!__OD_DISCORD) return null;`

### 5.5 GitHub Star 徽章

```typescript
const STAR_REPLACEMENTS = [
  { file: 'apps/web/src/components/useGithubStars.ts',
    old: "'https://github.com/nexu-io/open-design'",
    new: "'https://github.com/dmas-studio/dmas-design'" },
  { file: 'apps/web/src/components/GithubStarBadge.tsx',
    old: 'nexu-io/open-design',
    new: 'dmas-studio/dmas-design' },
];
```

当 `EntryShell.tsx` 中的 `<GithubStarBadge` 已经被 Discord 处理中一同包裹了条件渲染后，只在用户想彻底隐藏时才隐藏。如果用户有 GitHub repo 则保留展示。

## 6. `scripts/customize-restore.ts`

```typescript
// 恢复所有被 customize.ts 修改过的文件
const AFFECTED_FILES = [
  // 与 customize.ts 中的替换规则一致的文件列表
  // 按 glob 展开后的完整文件路径
];

function restore() {
  for (const file of AFFECTED_FILES) {
    execSync(`git checkout -- ${file}`);
  }
  console.log('All files restored.');
}
```

## 7. 幂等性保证

`simpleReplace` 工具函数的实现保证幂等性：

```typescript
function simpleReplace(file: string, old: string, replacement: string): number {
  let content = readFileSync(file, 'utf8');
  if (!content.includes(old)) {
    // 已被替换过或不需要替换，跳过
    return 0;
  }
  const updated = content.replaceAll(old, replacement);
  writeFileSync(file, updated);
  return countOccurrences(content, old); // 返回替换次数
}
```

Discord 注入同理：检查是否已有 `__OD_DISCORD` 常量，有则跳过。

## 8. 错误处理

| 场景 | 行为 |
|------|------|
| `git status --porcelain` 非空 | 打印提示，exit(1) |
| 文件不存在（上游重构后路径变化） | 打印 warning 并跳过，不中断 |
| 替换后文件内容与预期不一致 | dry-run 模式可预览 diff，实际执行不打 diff |
| 重复执行 | 幂等，跳过已替换的内容 |

## 9. 未覆盖和后续工作

- **需求二**（新增预设默认设计风格）：独立 spec，在 `design-systems/` 下创建品牌目录。
- **需求三**（入口简化）：独立 spec，处理 `NewProjectPanel`、chips、导航栏 Tab 过滤。
- **需求四**（Memory 预注入）：独立 spec，处理编译期 memory seeding。
- **DESIGN.md 模板变更**：属于需求二的范畴。
- **Windows NSIS 注册表清理**：如果之前安装过 `Open Design` 版本的安装包，新 `PRODUCT_NAME` 会创建独立注册表键，需要文档说明但不属于本脚本范围。

## 10. 验证清单

- [ ] `pnpm customize` 执行成功，无报错
- [ ] 未提交时执行被拒绝
- [ ] 重复执行不产生错误
- [ ] `pnpm customize:restore` 完全还原
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm tools-dev` 启动，Web UI 显示新品牌名
- [ ] 首页 Discord 入口不显示
- [ ] GitHub Star 指向用户仓库
- [ ] `pnpm tools-pack mac build --to all` 打包产物使用新 `PRODUCT_NAME`
