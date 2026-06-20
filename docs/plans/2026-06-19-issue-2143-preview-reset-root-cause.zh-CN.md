# Issue #2143 根因分析：编辑 / 标注工具导致预览重置回首页

- 关联 issue：https://github.com/nexu-io/open-design/issues/2143
- 关联设计文档：[`2026-06-19-issue-2143-preview-reset-design.zh-CN.md`](./2026-06-19-issue-2143-preview-reset-design.zh-CN.md)
- 分析基线：`origin/main`（含已合并的 #2844、#4365）
- 复现版本：本地 daemon（端口 63325），看板多文件原型（`index.html` + `board.html` + `stats.html`）

## 结论（一句话）

对「不带 `od-direct-edit.js` 桥」的多文件 HTML 工件，**编辑（以及审查 / 标注）模式会强制把预览从 URL-load iframe 切换到 srcDoc iframe**；而 URL-load iframe 是跨源的（`sandbox="allow-scripts"` 不含 `allow-same-origin`），宿主读不到 iframe 内部已经跳到的子页面（`board.html`），于是 srcDoc 只能用原始 `index.html` 的源码重建，预览退回首页，用户感知为「编辑功能丢失 / 预览被重置」。

已合并的 #4365 修的是「关闭 Draw 时 about:blank 重载」和「标注期间 file-watcher live-reload」，**都没有覆盖「进入 Edit 时传输翻转」这条路径**，所以实测仍未解决。

## 复现确认（Playwright 实测）

复现路径：打开 `index.html` → 点「看板」入口（iframe 内部跳转 `board.html`）→ 点编辑按钮（`[data-testid="manual-edit-mode-toggle"]`）。

点击编辑前后 iframe 状态对比（宿主侧 `document.querySelectorAll('iframe')` 实测）：

| 阶段 | `artifact-preview-frame-url-load`（URL-load iframe） | `artifact-preview-frame`（srcDoc iframe） |
|---|---|---|
| 编辑前 | `src = /api/projects/:id/raw/index.html?...&odPreviewBridge=scroll&...selection&...snapshot`，可见 | 隐藏 |
| 编辑后 | `src = about:blank`，`visibility: hidden`（被「停放」） | `src = null`，**可见，内容由 index.html 源码重建** |

编辑后截图（`.playwright-cli/od-edit-state.png`）经视觉确认：预览已从看板退回到首页仪表盘（「快捷入口」卡片），`board.html` 的导航状态丢失。

宿主侧读 iframe 内部地址直接抛跨源异常，印证 URL-load iframe 跨源：

```
SecurityError: Failed to read a named property 'href' from 'Location':
  Blocked a frame with origin "http://127.0.0.1:63325" from accessing a cross-origin frame.
```

## 根因链（逐条源码核实）

### 1. 多文件工件走 URL-load 传输

看板原型是多文件 HTML，`index.html` 不含外部 `<script src>` / `localStorage` / `.focus()`，所以 `htmlNeedsSandboxShim` / `htmlNeedsFocusGuard` 均为 false → `shouldUrlLoadHtmlPreview` 返回 true → 走 URL-load iframe。

- 判定函数：[`apps/web/src/components/file-viewer-render-mode.ts:76`](../../apps/web/src/components/file-viewer-render-mode.ts#L76) `shouldUrlLoadHtmlPreview`
- 沙箱 shim 判定：[`file-viewer-render-mode.ts:186`](../../apps/web/src/components/file-viewer-render-mode.ts#L186) `htmlNeedsSandboxShim`
- 焦点守卫判定：[`file-viewer-render-mode.ts:179`](../../apps/web/src/components/file-viewer-render-mode.ts#L179) `htmlNeedsFocusGuard`

### 2. URL-load iframe 跨源 → 宿主看不到内部导航

URL-load iframe 的 `src` 是 `/api/projects/:id/raw/index.html`，sandbox 不带 `allow-same-origin`。用户点「看板」链接后，iframe 内部跳转到 `board.html`，但宿主 React state（`source` / `livePreviewSource`）仍是 `index.html`。跨源使 `iframe.contentWindow.location.*` 从宿主侧不可读（见上文 SecurityError）。

### 3. 编辑强制翻转传输（srcDoc）

进入编辑时 [`apps/web/src/components/FileViewer.tsx:7280`](../../apps/web/src/components/FileViewer.tsx#L7280) `activateManualEditTool()`：

```ts
setManualEditSrcDocActive(true);   // ① 标记 srcDoc 激活
setManualEditMode(true);           // ② 开启编辑态
```

随后渲染决策（[`FileViewer.tsx:5280-5313`](../../apps/web/src/components/FileViewer.tsx#L5280-L5313)）：

```ts
const urlModeBridge = hasUrlModeBridge(source);                          // 源码无 od-direct-edit.js → false
const manualEditRequiresSrcDoc = manualEditSrcDocActive && !urlModeBridge; // true && !false → true
const useUrlLoadPreview = shouldUrlLoadHtmlPreview(urlLoadDecision) && !manualEditRequiresSrcDoc; // → false
```

其中 [`shouldUrlLoadHtmlPreview`](../../apps/web/src/components/file-viewer-render-mode.ts#L76) 对编辑态的判定（[`file-viewer-render-mode.ts:83`](../../apps/web/src/components/file-viewer-render-mode.ts#L83)）：

```ts
if (d.editMode && !d.urlModeBridge) return false;   // 编辑 + 无桥 → 强制 srcDoc
```

`useUrlLoadPreview` 翻成 false → 切到 srcDoc 传输，与实测 iframe 状态一致。

### 4. srcDoc 用的是 index.html 源码，board.html 导航从未被捕获

srcDoc 由 `previewSource` 构建（[`FileViewer.tsx:5406`](../../apps/web/src/components/FileViewer.tsx#L5406)）。编辑态下（[`FileViewer.tsx:5274`](../../apps/web/src/components/FileViewer.tsx#L5274)）：

```ts
const previewSource = (manualEditMode && manualEditFrozenSource !== null)
  ? manualEditFrozenSource            // 进入编辑瞬间从 livePreviewSource 冻结
  : ...;
```

`manualEditFrozenSource` 在 [`FileViewer.tsx:5256`](../../apps/web/src/components/FileViewer.tsx#L5256) 从 `livePreviewSource` 冻结而来，而 `livePreviewSource` = `index.html` 源码。**iframe 内部跳到 `board.html` 这件事，宿主从头到尾不知道**，所以 srcDoc 重建出来就是首页。

### 5. 现有三条注入桥都不传「路由 / 子页面」

daemon 侧按 `odPreviewBridge=` 注入三条桥（[`apps/daemon/src/project-routes.ts:2361`](../../apps/daemon/src/project-routes.ts#L2361)）：

| 桥 | 作用 | 中继符号 |
|---|---|---|
| `scroll` | 滚动位置捕获 / 恢复 | `od:preview-scroll` / `od:preview-scroll-restore`（[`project-routes.ts:57`](../../apps/daemon/src/project-routes.ts#L57)） |
| `selection` | 元素选中（评论 / 审查） | `od:comment-targets` 等（[`project-routes.ts:149`](../../apps/daemon/src/project-routes.ts#L149)） |
| `snapshot` | 导出截图（SVG foreignObject → PNG） | `od:snapshot:result`（[`project-routes.ts:545`](../../apps/daemon/src/project-routes.ts#L545)） |

全仓检索路由中继符号（`od:preview-route` / `previewHash` / `navigatedUrl` / `od:preview-navigate`）—— **零命中**。即翻转传输时，没有任何机制把「当前停在 board.html」带过去。`scroll` 桥保住的是滚动，不是路由。

## 为什么 #4365（最近一次合并）没修好

#4364 / #4365 修的是两件更窄的事，都不在「进入 Edit 翻转」路径上：

- **关闭 Mark/Draw 时不再把 URL-load iframe 停到 `about:blank` 触发整页重载** —— 修的是「关闭」路径（对应实测里 `url-load` iframe 的 `about:blank` 停放是「开启」时的行为，但可见的 srcDoc iframe 重建为 index.html 才是重置本体）。
- **标注进行中冻结 file-watcher 的 live-reload** —— 修的是「文件变更触发重载」，与本 bug 的「用户主动内部导航 + 主动进入编辑」无关。

issue 串里真正针对「路由 / 传输翻转」的 PR（#2344、#3313、#3327，思路是翻传输时 relay 路由 + 滚动，或干脆 comment/inspect 期间保活原 iframe）**一个都没合**：

```
git log --all | grep -iE "2143|route.*preview|preview.*route|transport.*flip|srcdoc.*route"
# 空 —— 路由中继 / 传输翻转相关修复从未落地
```

## 精确触发条件（四个同时成立）

1. 工件是**多文件 HTML**（走 URL-load 而非 srcDoc）；
2. 工件**不带 `od-direct-edit.js` 桥**（绝大多数 agent 生成的裸原型都不带）；
3. 用户在预览里**做了内部子页面跳转**（多文件链接 `board.html` / hash 路由 / pushState SPA）；
4. 在子页面状态下**进入 Edit / Inspect / 任意需要 srcDoc 桥的工具**。

条件 2 是分水岭：带 `od-direct-edit.js` 的工件编辑时 `manualEditRequiresSrcDoc=false`，会保持在 URL-load iframe、不翻转、不重置——所以本 bug 只命中「裸多文件原型」这一类。

> 注：审查（inspect）同样翻转（[`file-viewer-render-mode.ts:82`](../../apps/web/src/components/file-viewer-render-mode.ts#L82) `if (d.inspectMode) return false;`），所以 inspect 也有同样的重置问题。评论（comment）则**已经**走 URL selection 桥、不翻转（[`file-viewer-render-mode.ts:79`](../../apps/web/src/components/file-viewer-render-mode.ts#L79)），所以评论模式不复发——这条「评论已不翻转」的事实，正是方向 B 可行性的关键证据，详见设计文档。

## 涉及的关键文件

| 关注点 | 位置 |
|---|---|
| 传输判定（URL-load vs srcDoc） | [`apps/web/src/components/file-viewer-render-mode.ts`](../../apps/web/src/components/file-viewer-render-mode.ts) |
| 编辑激活、冻结源、传输翻转 | [`apps/web/src/components/FileViewer.tsx`](../../apps/web/src/components/FileViewer.tsx)（`activateManualEditTool` L7280、`previewSource` L5274、`manualEditRequiresSrcDoc` L5281） |
| 编辑桥脚本（注入 srcDoc） | [`apps/web/src/edit-mode/bridge.ts`](../../apps/web/src/edit-mode/bridge.ts) |
| srcDoc 构建 + 桥注入 | [`apps/web/src/runtime/srcdoc.ts`](../../apps/web/src/runtime/srcdoc.ts)（`buildSrcdoc` L38、`injectManualEditBridge` L638、`annotateManualEditSourcePaths` L563） |
| daemon URL 桥注入（scroll/selection/snapshot） | [`apps/daemon/src/project-routes.ts`](../../apps/daemon/src/project-routes.ts)（L2361、`injectUrlPreviewBridge` L750） |
| 编辑 → 源码回写（data-od-source-path 映射） | [`apps/web/src/edit-mode/source-patches.ts`](../../apps/web/src/edit-mode/source-patches.ts) |

下一步设计见 [`2026-06-19-issue-2143-preview-reset-design.zh-CN.md`](./2026-06-19-issue-2143-preview-reset-design.zh-CN.md)。
