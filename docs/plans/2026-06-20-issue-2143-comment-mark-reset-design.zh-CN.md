# Issue #2143 漏修跟进：Comment / Mark / Comments 按钮同样触发预览退回首页

- 关联 issue：https://github.com/nexu-io/open-design/issues/2143
- 上游根因：[`2026-06-19-issue-2143-preview-reset-root-cause.zh-CN.md`](./2026-06-19-issue-2143-preview-reset-root-cause.zh-CN.md)
- 上游设计：[`2026-06-19-issue-2143-preview-reset-design.zh-CN.md`](./2026-06-19-issue-2143-preview-reset-design.zh-CN.md)
- 已合并修复：`cce7d642d`（仅覆盖 `activateManualEditTool`）
- 设计基线：`origin/main`（含 `cce7d642d`）

## 背景与问题陈述

`cce7d642d` 按方向 A 实现了 edit 按钮的「路由中继」修复：daemon 加 `route` 桥、宿主用 `lastPreviewRouteRef` 缓存子页面路由、进入编辑时若跨文件则用 `onSwitchFile` 切当前文件再激活、同文件 hash SPA 由 `injectRouteRestoreBridge` + `od:preview-route-restore` 重放。

但该修复**只接了 `activateManualEditTool` 一条路径**。工具栏上还有三个会触发「传输翻转 / srcDoc 重建」的按钮同样会让预览退回首页：

| 按钮 | 入口 | toolbar 埋点 |
|---|---|---|
| Comment（toggle） | [`activateCommentTool`](../../apps/web/src/components/FileViewer.tsx#L7339) | `'comment'` |
| Mark（Draw） | [`activateDrawTool`](../../apps/web/src/components/FileViewer.tsx#L7311) | `'mark'` |
| Comments（count） | [`activateCommentCreateTool`](../../apps/web/src/components/FileViewer.tsx#L7368) | `'comment'` |

本地实测版本：daemon 端口 63218，多文件原型（`index.html` 链向 `board.html` 与 `stats.html`）。

## 现象与根因

三个按钮都会触发「预览退回首页」，但路径略有不同。

### Mark（Draw，`activateDrawTool`）

**必定翻转 srcDoc**。[`file-viewer-render-mode.ts:87`](../../apps/web/src/components/file-viewer-render-mode.ts#L87) 的 `if (d.drawMode) return false;` 让 `useUrlLoadPreview` 翻为 false，srcDoc 由 `previewSource` 重建。而 `previewSource` 取自 `annotationFrozenSource ?? livePreviewSource`（[`FileViewer.tsx:5305-5309`](../../apps/web/src/components/FileViewer.tsx#L5305)），两者都来自 `file.name`（`index.html`）的源码 —— 宿主读不到 iframe 内部已经跳到 `board.html` 这件事，srcDoc 只能用 `index.html` 重建，于是回到首页。

### Comment / Comments（`activateCommentTool` / `activateCommentCreateTool`）

按上游设计文档的判断本应「不翻转」，**但内部导航悄悄打破了这个前提**：

1. 用户在 `index.html` 里点 `board.html` 链接 → iframe 内部 navigation → iframe `onLoad` 触发。
2. [`FileViewer.tsx:9033`](../../apps/web/src/components/FileViewer.tsx#L9033) / [`:9058`](../../apps/web/src/components/FileViewer.tsx#L9058) 的 onLoad 处理把 `urlSelectionBridgeReady` 重置为 false，再发 `od:url-selection-bridge-probe`。
3. 但 iframe 现在的 URL 是 `/api/projects/.../raw/board.html`（链接没带 `?odPreviewBridge=selection`），daemon 不会注入 selection 桥 → 无人应答 → `urlSelectionBridgeReady` 一直停在 false。
4. 用户点 Comment → `boardMode=true` → `urlLoadDecision.commentMode=true, urlCommentBridge=false`。
5. `shouldUrlLoadHtmlPreview` 在 [`file-viewer-render-mode.ts:79`](../../apps/web/src/components/file-viewer-render-mode.ts#L79) 命中：`commentMode && !(urlCommentBridge || urlModeBridge)` → 返回 false → srcDoc 翻转 → 同样退回首页。

Comments 按钮走的也是 `activateBoard('inspect')`，同根因。

### 一句话总结

三个按钮都触发了「带状态翻转 srcDoc」，而 srcDoc 重建用的源码来自 `file.name`，宿主又读不到 iframe 跨源内部导航 → 退回首页。这和 #2143 的 edit 路径**完全同根**，只是 edit 已修，其他三个没修。

## 修复方案

把已落地的 edit 修复模式（`lastPreviewRouteRef` + `onSwitchFile` + pending ref + hash restore）**推广到这三个按钮**。骨架已经齐备（`route` 桥、`injectRouteRestoreBridge`、`onSwitchFile={openFile}` 都已就位），本次主要是 web 端接线。

### 改动 1：把 `pendingManualEditForFileRef` 泛化为「待执行标注激活」

```ts
type PendingAnnotationActivation = {
  file: string;
  kind: 'comment' | 'commentCreate' | 'draw' | 'edit';
};
const pendingAnnotationActivationRef = useRef<PendingAnnotationActivation | null>(null);
```

把现有 `pendingManualEditForFileRef` 的两处用法（写入 + `file.name` effect 消费）替换成上面这个统一结构，effect 里按 `kind` 分派到各自的激活逻辑。

### 改动 2：每个 activate 函数抽核心激活为 helper，并在入口做 route 检查

抽出 `performCommentActivation` / `performCommentCreateActivation` / `performDrawActivation` / `performManualEditActivation`，让立即激活与延迟激活共用同一份逻辑（避免双份漂移）。

公共延迟器：

```ts
function maybeDeferAnnotationForRoute(kind: PendingAnnotationActivation['kind']): boolean {
  const route = lastPreviewRouteRef.current;
  if (!route?.file) return false;
  if (route.file === file.name) return false;
  if (typeof onSwitchFile !== 'function') return false;
  pendingAnnotationActivationRef.current = { file: route.file, kind };
  onSwitchFile(route.file);
  closeArtifactToolMenus();
  return true;
}
```

每个 activate 函数在「真正要进入激活态」前插一道：

```ts
// activateCommentTool / activateCommentCreateTool 里
if (manualEditMode) {
  void exitManualEditModeAfterFlush().then((ok) => {
    if (!ok) return;
    if (maybeDeferAnnotationForRoute('comment')) return;
    performCommentActivation();
  });
  return;
}
if (maybeDeferAnnotationForRoute('comment')) return;
performCommentActivation();

// activateDrawTool 里同理，kind 用 'draw'
```

`activateDrawTool` 保留 `if (!next) { … }` 的退出分支不变；`activateManualEditTool` 用 `'edit'`。

### 改动 3：pending effect 按 kind 分派

把现有消费 `pendingManualEditForFileRef` 的 effect 改为：

```ts
useEffect(() => {
  const pending = pendingAnnotationActivationRef.current;
  if (!pending || pending.file !== file.name) return;
  pendingAnnotationActivationRef.current = null;
  if (pending.kind === 'edit') performManualEditActivation();
  else if (pending.kind === 'comment') performCommentActivation();
  else if (pending.kind === 'commentCreate') performCommentCreateActivation();
  else if (pending.kind === 'draw') performDrawActivation();
}, [file.name]);
```

### 改动 4：hash restore effect 扩展到所有 srcDoc 翻转场景

当前 [`FileViewer.tsx:5692-5711`](../../apps/web/src/components/FileViewer.tsx#L5692) 的 effect 只在 `manualEditMode` 下跑：

```ts
useEffect(() => {
  if (!manualEditMode) return;
  …
}, [manualEditMode, file.name, srcDoc]);
```

对 Mark（必定 srcDoc）和「URL selection 桥不可用时被翻成 srcDoc 的 Comment」也要跑。把守卫从 `!manualEditMode` 改成 `useUrlLoadPreview`（即「srcDoc 是当前活动传输」时才需要 replay hash），deps 也换掉：

```ts
useEffect(() => {
  if (useUrlLoadPreview) return;        // URL-load 天然保 hash，不需要 replay
  const route = lastPreviewRouteRef.current;
  if (!route?.hash) return;
  if (route.file && route.file !== file.name) return;
  // 原有 send / raf / setTimeout 逻辑不变
}, [useUrlLoadPreview, file.name, srcDoc]);
```

> 跨文件 case 在改动 1-3 里已经通过切到子文件解决（切完后 `file.name === route.file`），这里只剩「同文件 hash SPA」需要 replay。Mark 在同文件 hash SPA 下也吃这条路径。

### 改动 5（无需改，仅说明）

切到子文件后，老的 `lastPreviewRouteRef`（指向 `board.html`）应当在新 iframe 首次 route 上报后被覆盖。现有 [`useEffect(() => { lastPreviewRouteRef.current = null; }, [projectId, file.name])`](../../apps/web/src/components/FileViewer.tsx#L5398) 已经在文件切换时清空，覆盖范围足够，不动。

## 为什么不直接走方向 B（免翻转）

上游设计文档里方向 B（daemon 注入 edit/inspect URL 桥 + 服务端注解）能根治所有路由形态，但改动面大、还要抽共享注解纯函数包。本次只是把已落地的方向 A 推广到三个漏修按钮，**风险与已合并的 #2143 修复同一档**：

- ✅ 立刻消除用户可感的「退回首页」。
- ✅ 复用已有的 `route` 桥、`onSwitchFile`、`injectRouteRestoreBridge`，不新增 daemon 侧改动。
- ⚠️ 治标不治本：Comment 在「URL selection 桥就绪」时虽然不翻转，但只要桥因任何原因掉线（内部导航、网络抖动），仍会回落到 srcDoc 路径，依赖方向 A 的 route 桥兜底。彻底解决仍需方向 B。

## 边界与时序

- **竞态**：URL-load 工件全程挂着 `route` 桥（[`FileViewer.tsx:5345`](../../apps/web/src/components/FileViewer.tsx#L5345) 的 `odPreviewBridge=route`），正常浏览期间已持续上报，进入标注工具时 `lastPreviewRouteRef` 已有值；仅在「打开文件后第一帧就立刻点按钮」的极端竞态下可能为空，此时退化为原行为（同文件），可接受。
- **退路**：`onSwitchFile` 仅在 `FileWorkspace` 已接线时生效；若上层未传，`maybeDeferAnnotationForRoute` 返回 false，落回立即激活（同 #2143 修复的退路一致）。
- **退出分支保留**：每个 activate 函数原本的「再次点击关闭」分支不动；只插进入分支。

## 验收（红色测试用例）

沿用 #2143 的 e2e 模式（`e2e/lib/tools-dev/` + `@/playwright/suite`），在 daemon HTTP 边界编码可证伪用例，覆盖矩阵：

| 路由形态 × 按钮 | comment | mark | comments |
|---|---|---|---|
| 跨文件（`index.html` → `board.html`） | 切到 board.html 后进 comment | 切到 board.html 后进 draw | 切到 board.html 后进 commentCreate |
| 同文件 hash SPA（`index.html#board`） | 保持 URL-load 不复位 | srcDoc 重建后 hash replay 成功 | 同左 |

断言点：iframe 内可见 `board.html` 特征文案 / 列标题，而不是 `index.html` 的「快捷入口」卡片。

## 涉及的关键文件

| 文件 | 改动 |
|---|---|
| `apps/web/src/components/FileViewer.tsx` | pending ref 泛化 + 三个 activate 函数 route 检查 + hash restore effect 守卫扩展 |
| 参考（无需改） | `apps/daemon/src/project-routes.ts`（route 桥已就位）、`apps/web/src/runtime/srcdoc.ts`（`injectRouteRestoreBridge` 已就位）、`apps/web/src/components/FileWorkspace.tsx:2256`（`onSwitchFile={openFile}` 已接线） |
