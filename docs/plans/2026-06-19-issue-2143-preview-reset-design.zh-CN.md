# Issue #2143 修复设计：方向 A（路由中继）与方向 B（免翻转）

- 关联 issue：https://github.com/nexu-io/open-design/issues/2143
- 根因分析：[`2026-06-19-issue-2143-preview-reset-root-cause.zh-CN.md`](./2026-06-19-issue-2143-preview-reset-root-cause.zh-CN.md)
- 设计基线：`origin/main`

## 背景与问题陈述

根因已确认（见根因文档）：编辑 / 审查对「裸多文件 HTML 工件」会强制翻转预览传输（URL-load → srcDoc），而 URL-load iframe 跨源，宿主读不到内部子页面导航，srcDoc 只能用原始文件源码重建，预览退回首页。

两个方向的本质区别：

- **方向 A（路由中继 / 增量）**：承认「翻转」这个架构现状不动，补一条「路由」中继桥，在翻转前后把子页面路由带过去。
- **方向 B（免翻转 / 根治）**：让编辑（和审查）像评论一样**根本不翻转**，保持 URL-load iframe 挂载，浏览上下文天然不丢。

## 共享技术背景（两个方向都用得到的事实）

### 现有「桥」架构

宿主与预览 iframe 之间有两套等价桥注入路径：

1. **srcDoc 桥**（web 进程，[`srcdoc.ts:38 buildSrcdoc`](../../apps/web/src/runtime/srcdoc.ts#L38)）：在 web 端把桥脚本拼进 srcDoc 字符串。注入项有 selection / palette / edit / tweaks / snapshot / deck / transport。
2. **URL 桥**（daemon 进程，[`project-routes.ts:750 injectUrlPreviewBridge`](../../apps/daemon/src/project-routes.ts#L750)）：daemon 在响应 `/api/projects/:id/raw/:file` 时，按 `?odPreviewBridge=<token>` 把桥脚本拼进 HTML。现支持 `scroll` / `selection` / `snapshot` 三种。

关键事实：**评论模式已经走 URL selection 桥、不翻转 srcDoc**。

- [`file-viewer-render-mode.ts:79`](../../apps/web/src/components/file-viewer-render-mode.ts#L79)：`if (d.commentMode && !(d.urlCommentBridge || d.urlModeBridge)) return false;` —— 评论在 `urlCommentBridge` 就绪时**保持 URL-load**。
- 宿主靠 `od:url-selection-bridge-ready` 握手确认桥就绪（[`FileViewer.tsx:5468`](../../apps/web/src/components/FileViewer.tsx#L5468)）。

这条「评论已免翻转」的事实 = 方向 B 可行性的现成证据：把编辑桥也做成 URL 桥即可。

### 编辑桥（manual edit bridge）内部结构

- 脚本本体：[`apps/web/src/edit-mode/bridge.ts`](../../apps/web/src/edit-mode/bridge.ts)，**自包含、纯脚本、无外部依赖**，理论上可在 URL-load 里跑。
- 注入器：[`srcdoc.ts:638 injectManualEditBridge`](../../apps/web/src/runtime/srcdoc.ts#L638) —— 注入三件：键盘守卫（`<head>` 开）、桥样式（`</head>`）、桥脚本（`</body>`）。
- 消息协议（宿主 ↔ iframe）：
  - 宿主 → iframe：`od-edit-mode {enabled}`（开关）、`od-edit-preview-style {id,styles,version}`（实时样式预览）、选中目标 id。
  - iframe → 宿主：`od-edit-targets {targets}`（可选中元素清单）、`od-edit-hover`、`od-edit-text-commit`、`od-edit-preview-style-applied`。
- 元素定位依赖三类注解属性：`data-od-id`、`data-od-source-path`、`data-od-runtime-id`。
  - `data-od-source-path` 是「DOM 子索引路径」（如 `path-0-1-2`），用于把预览里选中的元素映射回源码位置做回写（[`source-patches.ts:165`](../../apps/web/src/edit-mode/source-patches.ts#L165)）。
  - 这些注解当前在 web 进程的 `buildSrcdoc` 里通过 DOMParser 加（[`srcdoc.ts:563 annotateManualEditSourcePaths`](../../apps/web/src/runtime/srcdoc.ts#L563)、[`srcdoc.ts:602 annotateMissingOdIds`](../../apps/web/src/runtime/srcdoc.ts#L602)）。

---

## 方向 A：路由中继（增量、低风险）

### 目标与范围

不动「翻转」架构，新增一条 `route` 桥，在 iframe 内部捕获子页面路由并回传宿主缓存；进入编辑（及任何 srcDoc 翻转）时按缓存的路由恢复。目标是**用最小改动消除「退回首页」这个症状**。

### 能力边界（重要）

`route` 桥运行在 **iframe 内部**，与 iframe 自身同源，因此 `location.href / pathname / hash` 在桥内部**可读**——跨源限制只挡「宿主读子帧」，不挡「子帧读自己」。所以宿主**能**通过桥得知「现在停在 board.html」。

但「恢复」按路由形态分两种，难度不同：

| 路由形态 | 例子 | 恢复难度 |
|---|---|---|
| 同文件 hash / in-doc 路由 | 单文件 SPA，`#board`、`location.hash`、pushState 不换文件 | 低：srcDoc 重建后把 hash / 状态重放给新 iframe |
| 跨文件链接 | 多文件原型，`board.html` 是独立文件 | 中：需切换「当前编辑文件」或拉取目标文件源码重建 |

### 详细改动

#### A1. daemon 新增 `route` 桥（与 scroll 桥同构）

在 [`project-routes.ts`](../../apps/daemon/src/project-routes.ts) 仿照 `URL_PREVIEW_SCROLL_BRIDGE`（L57）新增 `URL_PREVIEW_ROUTE_BRIDGE`，监听 `hashchange` / `popstate`，并在加载后立即上报一次：

```js
// 伪代码，注入到 </body> 前
(function(){
  if (window.__odUrlRouteBridge) return;
  window.__odUrlRouteBridge = true;
  function report(){
    try {
      window.parent.postMessage({
        type: 'od:preview-route',
        href: location.href,        // 完整 URL，含文件名
        path: location.pathname,    // 用于识别跨文件：/api/.../raw/board.html
        hash: location.hash,
        search: location.search
      }, '*');
    } catch (_) {}
  }
  window.addEventListener('hashchange', report);
  window.addEventListener('popstate', report);
  // 拦截 pushState / replaceState 以捕获 SPA 路由
  ['pushState','replaceState'].forEach(function(m){
    var orig = history[m];
    history[m] = function(){ orig.apply(this, arguments); report(); };
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report, { once: true });
  else setTimeout(report, 0);
  window.parent.postMessage({ type: 'od:url-route-bridge-ready' }, '*');
})();
```

判定与注入接线：

- 新增 `wantsUrlPreviewRouteBridge`（仿 [`project-routes.ts:729`](../../apps/daemon/src/project-routes.ts#L729)）。
- [`project-routes.ts:2361`](../../apps/daemon/src/project-routes.ts#L2361) 的注入分支补一条 `route`。
- [`FileViewer.tsx:5315`](../../apps/web/src/components/FileViewer.tsx#L5315) `basePreviewSrcUrl` 的 `odPreviewBridge=...` 列表加 `&odPreviewBridge=route`（URL-load 工件全程挂上，被动监听，零成本）。

#### A2. 宿主缓存「最后已知路由」

在 FileViewer 增 `lastPreviewRouteRef`，监听 `od:preview-route` 更新（仿 `od:url-selection-bridge-ready` 的 message 监听，[`FileViewer.tsx:5462`](../../apps/web/src/components/FileViewer.tsx#L5462)）。结构：

```ts
type PreviewRoute = { file?: string; hash?: string; search?: string; href: string };
const lastPreviewRouteRef = useRef<PreviewRoute | null>(null);
```

`file` 从 `path` 解析（`/api/projects/:id/raw/<file>` 的最后一段），与 `file.name` 比较即可判断同文件 / 跨文件。

#### A3. 进入编辑时按路由恢复（核心）

改 [`activateManualEditTool`](../../apps/web/src/components/FileViewer.tsx#L7280)，在 `setManualEditMode(true)` 之前插入路由恢复决策：

```ts
function activateManualEditTool() {
  fireArtifactToolbarClick('edit');
  capturePreviewScrollPosition();
  if (!manualEditMode) {
    // …原有清理…
    const route = lastPreviewRouteRef.current;
    if (route?.file && route.file !== file.name) {
      // 跨文件：切到用户实际在看的子文件，再进编辑
      // （见 A3-a：切当前文件）
      switchActiveFileForRoute(route.file).then(() => enterEditOnCurrentFile());
      return;
    }
    enterEditOnCurrentFile();   // 同文件或无路由：原流程
    return;
  }
  // …退出编辑…
}
```

- **A3-a 跨文件恢复（推荐）**：把「当前编辑文件」切到 `board.html`。这样 srcDoc 用 `board.html` 源码重建，预览显示看板，编辑也正确指向看板元素——「所见即所编」。代价：文件标签会从 `index.html` 跳到 `board.html`（语义上合理，因为用户确实在看 / 想编看板）。
  - 实现复用现有切文件能力（与 [`FileViewer.tsx:5344`](../../apps/web/src/components/FileViewer.tsx#L5344) 文件切换 effect 同源），切完再 `setManualEditMode(true)`。
- **A3-b 同文件 hash 恢复**：srcDoc 重建后，在新 srcDoc iframe 的 `onLoad` / `od:srcdoc-transport-ready` 里 `postMessage({type:'od:preview-route-restore', hash, search})`，桥收到后 `location.hash = hash` 并重放 SPA 路由状态。
  - `route` 桥补一个 `od:preview-route-restore` 入站处理（仿 scroll 桥的 `od:preview-scroll-restore`，[`project-routes.ts:114`](../../apps/daemon/src/project-routes.ts#L114)）。

#### A4. 关闭编辑后回退（可选）

退出编辑回到 URL-load 时，若 A3-a 切过文件，按需切回原文件或保持在子文件（产品决策，默认保持在子文件更贴近用户预期）。

### 边界与风险

- **真正的多文件编辑语义**：A3-a 把编辑目标切到子文件，是「正确」行为，但改变了「文件标签」的可见状态，需要产品确认。
- **未捕获的路由形态**：`<a target>` 跳新窗口、`location.replace` 到站外等不会触发 `popstate`/`hashchange`；`route` 桥尽力而为。
- **时序**：`route` 桥的首次上报要在「用户点击编辑前」完成。因为 URL-load 工件全程挂着 `route` 桥（A1），正常浏览期间已持续上报，进入编辑时 `lastPreviewRouteRef` 已有值；仅在「打开文件后第一帧就立刻点编辑」的极端竞态下可能为空，此时退化为原行为（同文件），可接受。
- **不解决审查 / Draw 的同类重置**：方向 A 只补编辑路径；审查（inspect）同样翻转，需同样接一遍（或一并走方向 B）。

### 优劣

- ✅ 改动小、风险低、不动核心传输架构；daemon 侧只加一条与 scroll 同构的桥。
- ✅ 对「同文件 hash SPA」恢复干净。
- ⚠️ 对「跨文件」需要切当前文件，有产品语义副作用。
- ⚠️ 治标：翻转架构仍在，后续每个「需要 srcDoc 桥的工具」都要再接一遍路由恢复。

---

## 方向 B：免翻转（根治、改动大）

### 目标与范围

让编辑（和审查）像评论一样**根本不翻转传输**——保持 URL-load iframe 挂载，浏览上下文（路由、滚动、JS 状态）天然不丢。一劳永逸消除「退回首页」，对所有路由形态（hash SPA + 多文件）都生效。

### 可行性依据

评论模式已证明「selection 桥可以跑在 URL-load iframe 里、不需要 srcDoc」（见共享背景）。编辑桥同样是自包含脚本（[`bridge.ts`](../../apps/web/src/edit-mode/bridge.ts)），把它 port 成 daemon URL 桥即可。issue 串里维护方多次倾向的 #3327 方向（「comment/inspect 期间保活原 iframe，Sec-Fetch-Dest 桥注入」）正是本方向。

### 详细改动

#### B1. daemon 新增 `edit` 桥注入（镜像 selection 桥）

在 [`project-routes.ts`](../../apps/daemon/src/project-routes.ts) 仿 `URL_PREVIEW_SELECTION_BRIDGE`（L149）新增 `URL_PREVIEW_EDIT_BRIDGE`，内容取自 [`bridge.ts`](../../apps/web/src/edit-mode/bridge.ts) 的 `buildManualEditBridge(false)` + 键盘守卫 + 样式三件套（即 [`injectManualEditBridge`](../../apps/web/src/runtime/srcdoc.ts#L638) 的等价物，搬到 daemon 字符串注入）。

- 新增 `wantsUrlPreviewEditBridge`（仿 L729）。
- [`project-routes.ts:2361`](../../apps/daemon/src/project-routes.ts#L2361) 注入分支补 `edit`。
- 注入要幂等（`if (window.__odUrlEditBridge) return;`），因为 `odPreviewBridge=` 是多值重复参数。

#### B2. daemon 侧补元素注解（本方向的硬骨头）

编辑桥依赖 `data-od-id` / `data-od-source-path` / `data-od-runtime-id`。其中：

- `data-od-id` / `data-od-source-path` 当前由 web 端 DOMParser 加（[`annotateMissingOdIds`](../../apps/web/src/runtime/srcdoc.ts#L602) / [`annotateManualEditSourcePaths`](../../apps/web/src/runtime/srcdoc.ts#L563)）。URL-load 路径下 daemon 直接吐原始 HTML，**没有这些注解**，编辑桥会选不到元素。
- 解决：把这两步注解 port 到 daemon。daemon 已有 HTML 转换链（`maybeResolveVitePreviewHtml` 等，[`project-routes.ts:2352`](../../apps/daemon/src/project-routes.ts#L2352)），在桥注入前插一道「DOM 遍历加注解」即可。
- 实现注意：
  - web 端用浏览器 DOMParser；daemon 是 Node，需用服务端 HTML 处理。优先复用 daemon 已有的 HTML 解析依赖；若没有，引入一个轻量 parser（如 `parse5` / `linkedom`），仅在 `text/html` 且请求了 `edit`/`selection` 桥时才跑，避免给普通预览请求加成本。
  - 注解算法与 web 端保持一致（同一 `MANUAL_EDIT_DISCOVERY_SELECTOR`、同一 `sourcePathForElement` 子索引算法），否则「预览选中的元素」与「源码回写位置」会对不上。建议把注解逻辑抽到一个**纯函数共享包**（放 `packages/contracts` 不合适——它禁 fs/浏览器 API；可放一个新的小包或在 daemon/web 各引用同一份纯逻辑），web 与 daemon 共用，避免双份漂移。
- `data-od-runtime-id` 由桥脚本运行时自行补（[`bridge.ts:36`](../../apps/web/src/edit-mode/bridge.ts#L36)），无需服务端处理。

#### B3. web 端允许「编辑态走 URL-load」

- [`file-viewer-render-mode.ts:83`](../../apps/web/src/components/file-viewer-render-mode.ts#L83)：把
  ```ts
  if (d.editMode && !d.urlModeBridge) return false;
  ```
  改为镜像评论的做法：引入 `urlEditBridge` 就绪标志，编辑在 URL edit 桥就绪时保持 URL-load：
  ```ts
  if (d.editMode && !(d.urlModeBridge || d.urlEditBridge)) return false;
  ```
- `UrlLoadDecision` 增 `urlEditBridge?: boolean`（[`file-viewer-render-mode.ts`](../../apps/web/src/components/file-viewer-render-mode.ts) 接口）。
- FileViewer 增 `urlEditBridgeReady` state + `od:url-edit-bridge-ready` 握手监听（仿 [`FileViewer.tsx:5462`](../../apps/web/src/components/FileViewer.tsx#L5462) 的 selection 握手），喂给 `urlLoadDecision.urlEditBridge`。
- `basePreviewSrcUrl`（[`FileViewer.tsx:5315`](../../apps/web/src/components/FileViewer.tsx#L5315)）的 `odPreviewBridge=` 列表按需加 `edit`（编辑态开启时；或全程挂着被动等待，与 selection 一致）。

#### B4. 取消「编辑强制 srcDoc」

- [`FileViewer.tsx:7292`](../../apps/web/src/components/FileViewer.tsx#L7292) `activateManualEditTool` 里的 `setManualEditSrcDocActive(true)` 改为**仅当工件确实需要 srcDoc 时**才置 true（即 `needsSandboxShim` / `needsFocusGuard` / deck 等 srcDoc-only 场景）。对 URL-load 工件，保持 `manualEditSrcDocActive=false` → `manualEditRequiresSrcDoc=false` → `useUrlLoadPreview=true` → 不翻转。
- `manualEditFrozenSource`（[`FileViewer.tsx:5256`](../../apps/web/src/components/FileViewer.tsx#L5256)）的冻结逻辑对 URL-load 路径不再需要（无 srcDoc 重建），改为只在 srcDoc 路径生效。

#### B5. 审查（inspect）一并免翻转（顺带修同类 bug）

审查同样翻转（[`file-viewer-render-mode.ts:82`](../../apps/web/src/components/file-viewer-render-mode.ts#L82)）。selection 桥已支持 inspect 的元素选中，把 inspect 也改成 URL-load（与评论共用 `urlCommentBridge`/selection 桥即可），消除审查的重置。Draw 因依赖 srcDoc 截图快照，仍保留 srcDoc（见下方「残留 srcDoc 场景」）。

### 残留 srcDoc 场景（B 不覆盖，需 A 兜底）

即便走 B，以下场景仍必须 srcDoc，此时「翻转重置」问题会残留，建议叠加方向 A 的 route 桥兜底：

- **Draw**：依赖 srcDoc snapshot 桥做截图导出（[`snapshot` 桥虽已 URL 化，但 draw 的标注坐标体系仍按 srcDoc 快照设计](../../apps/daemon/src/project-routes.ts#L545)）。
- **沙箱 shim 工件**：读 `localStorage` / 外部 `<script src>` 的原型，必须 srcDoc 跑 `injectSandboxShim`（[`srcdoc.ts:724`](../../apps/web/src/runtime/srcdoc.ts#L724)）。
- **焦点守卫工件**：含 `.focus()` / `autofocus`，必须 srcDoc 跑 `injectPreviewFocusGuard`。
- **Deck**：幻灯片走 deck 桥。

→ 结论：**B 为目标方案，A 的 route 桥作为残留 srcDoc 场景的兜底**，两者组合最稳。

### 边界与风险

- **服务端注解性能**：每次 raw HTML 请求做一次 DOM 注解遍历。用「仅 edit/selection 桥请求时才跑」+「按需」控制；多文件原型每文件独立注解，反而比 srcDoc 把所有文件拼成一个大字符串更省。
- **注解一致性**：web 与 daemon 必须用同一份注解纯逻辑，否则选中↔源码映射漂移。抽共享纯函数包。
- **桥脚本双份维护**：edit 桥脚本目前在 web（`bridge.ts`），B 后 daemon 也要一份。应让 daemon 直接 import / 构建时注入同一份脚本字符串，避免双份漂移（selection 桥已是 daemon 独立维护，可作为反例警示）。
- **时序握手**：编辑态切 URL-load 后，必须等 `od:url-edit-bridge-ready` 再下发 `od-edit-mode {enabled:true}`，否则桥还没装监听就丢消息（selection 桥的 `urlSelectionBridgeReady` 即为此设计，照搬）。
- **文本提交（od-edit-text-commit）**：编辑桥的 inline 文本编辑在 URL-load 同样可用（同源脚本操作自身 DOM），但提交后回写源码要走 daemon 写文件 + 重新 raw 拉取，注意缓存破坏（`?v=mtime` / `r=reloadKey`，[`FileViewer.tsx:5315`](../../apps/web/src/components/FileViewer.tsx#L5315)）。

### 优劣

- ✅ 根治：对所有路由形态（hash SPA + 多文件）都生效，浏览上下文天然不丢。
- ✅ 多文件编辑更正确：每文件独立注解，选中即该文件元素，无 srcDoc「单 blob」歧义。
- ✅ 与评论模式架构统一（都走 URL 桥），降低长期维护成本。
- ✅ 顺带修审查的重置。
- ⚠️ 改动大：服务端注解、桥脚本共享、握手时序、i18n / 测试面广。
- ⚠️ 残留 srcDoc 场景（Draw / 沙箱 shim / 焦点守卫 / Deck）仍需 A 兜底。

---

## 方向对比

| 维度 | 方向 A（路由中继） | 方向 B（免翻转） |
|---|---|---|
| 改动量 | 小（一条 daemon 桥 + 宿主缓存 + 恢复逻辑） | 大（daemon edit 桥 + 服务端注解 + web 免翻转 + 握手） |
| 风险 | 低，不动核心架构 | 中高，触及 raw HTML 响应链与注解一致性 |
| hash SPA 路由 | ✅ 干净 | ✅ 天然 |
| 多文件跨页路由 | ⚠️ 需切当前文件（产品副作用） | ✅ 天然，且编辑语义更正确 |
| 审查（inspect）重置 | ❌ 需再接一遍 | ✅ 顺带修 |
| 治标 / 治本 | 治标（翻转架构仍在） | 治本（与评论统一） |
| 与 issue 串已有 PR 关系 | 接近 #3313 思路（保滚动 + 补路由） | 接近 #3327 思路（保活原 iframe + daemon 桥注入） |

## 推荐路径

**以方向 B 为目标，方向 A 的 route 桥作为残留 srcDoc 场景兜底，分两步走：**

1. **第一步（先止血，可独立合并）**：落地方向 A 的 `route` 桥 + 同文件 hash 恢复 + 跨文件切当前文件。低风险、立刻消除用户可感的「退回首页」。同时为残留 srcDoc 场景预留恢复通道。
2. **第二步（根治）**：落地方向 B 的 edit/inspect 免翻转（daemon edit 桥 + 服务端注解 + web 免翻转 + 握手），把编辑 / 审查与评论统一到 URL 桥架构。完成后，第一步的 route 桥退化为 Draw / 沙箱 shim / 焦点守卫 / Deck 等 srcDoc-only 场景的兜底。

这与 issue 串里维护方多次表达的倾向（等 #3327 方向收敛、而非新开广覆盖 PR）一致——**重启 #3327 rebase 到最新 main 是落地方向 B 最省力的路径**。

## 验收（红色测试用例建议）

按仓库 Bug follow-up workflow（`AGENTS.md`），以 e2e 在 daemon HTTP 边界编码一个可证伪用例：

1. **红**：多文件原型（`index.html` 链向 `board.html`），在 `main` 上：预览进入 `board.html` → 点编辑 → 断言预览仍停留在 `board.html`（如断言 iframe 内可见看板特征文案 / 列标题）。当前 `main` 该断言失败（退回 index.html）。
2. **绿**：在修复分支上同用例通过。
3. 覆盖矩阵：同文件 hash 路由 × {edit, inspect}、跨文件链接 × {edit, inspect}、URL-load 工件 × Draw（残留 srcDoc 兜底）。

e2e 套件复用 `e2e/lib/tools-dev/` 与 `@/playwright/suite`（见 `AGENTS.md` 验证策略），不手搓 tools-dev。

## 涉及的关键文件（两方向汇总）

| 方向 | 文件 | 改动 |
|---|---|---|
| A | `apps/daemon/src/project-routes.ts` | 新增 `route` 桥常量 + `wantsUrlPreviewRouteBridge` + 注入分支 |
| A | `apps/web/src/components/FileViewer.tsx` | `route` 缓存 ref + `activateManualEditTool` 恢复决策 + `odPreviewBridge=route` |
| B | `apps/daemon/src/project-routes.ts` | 新增 `edit` 桥注入 + 服务端 `data-od-id`/`data-od-source-path` 注解 |
| B | `apps/web/src/components/file-viewer-render-mode.ts` | `urlEditBridge` 字段 + 编辑态免翻转判定 |
| B | `apps/web/src/components/FileViewer.tsx` | `urlEditBridgeReady` 握手 + 取消 `setManualEditSrcDocActive(true)` 强制 |
| A+B | 注解纯逻辑（新共享位置） | web/daemon 共用 `annotateMissingOdIds` / `annotateManualEditSourcePaths` |
| 参考 | `apps/web/src/edit-mode/bridge.ts` / `source-patches.ts` | edit 桥脚本与源码回写映射（保持注解一致性） |
