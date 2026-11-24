Check work: `pnpm build:desktop` (builds packages, runs biome check, tsc, vite build, cargo check). For quick iteration use `pnpm check` and desktop tsc.

After React changes, run `pnpm check:react-compiler`; CI rejects components the compiler skips.

Every PR with a user-visible change adds a `CHANGELOG.md` entry. Follow the `changelog` skill.

When asked why you made a decision, answer why. Don't take it as a challenge to your approach, or pressure to change your solution.

## Agent skills

Write skills in `.agents/skills/<name>/`, then symlink them into `.claude/skills/`.

### Issue tracker

GitHub Issues on `bholmesdev/hubble.md` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults: `needs-triage`, `ready-to-implement`, `needs-discussion`, `duplicate`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Human review readiness

Use /simplify before handing code to a human reviewer.

## feat/notion 分支交接（2026-11-24）

在 `feat/notion` 分支为 Hubble 补了一套 Notion 风格的子页 / 双链 / 大纲 / Toggle 能力。所有改动都在 `feat/notion`，未合并 main。tag 记录了阶段性稳定点：`toggle-v1`、`subpage-v1`、`subpage-v1.1`。

### 已完成

**Toggle & 大纲（`toggle-v1`）**
- Tiptap `toggleBlock` 节点 + 大纲侧栏 + `/date` 命令

**子页 / 双链 / 反链（`subpage-v1`）**
- `[[wiki-link]]` mark + `childPage` 原子节点；在页面内创建的新页默认落到同名 sibling 文件夹（`A.md` → `A/Untitled.md`）
- `/page`、`[[` 补全、"Turn into page" 三条入口都走 `createChildPage` / `turnBlockIntoChildPage`
- 重命名 / 移动时 `rewriteWikiLinksInContent` 自动改引用（stem 歧义时跳过）
- 反链面板 `BacklinksPanel`、面包屑 `Breadcrumb`
- Hover 预览 + 失效链接灰显（`WikiLinkValidityExtension`）

**`subpage-v1.1` 修复**
- `EditorView` 漏挂 `AtMentionExtension` / `WikiLinkPicker` — 补上
- `[[` 走新 picker 并支持 Create；picker 关闭移到 `await` 前
- modal Input 的 focus-select / `stopPropagation` / 链接后输入 3 个 bug
- 去掉自动弹出的 `LinkPopover`
- Sidebar paired 行 chevron 变可点击（之前只能靠方向键收起）

### 主要改动文件
- `packages/editor/src/`：`ChildPage.ts`、`WikiLinkValidityExtension.ts`、`markdown{To,From}Prosemirror.ts`
- `packages/ui/src/editor/`：`EditorView.tsx`、`WikiLinkPicker.tsx`、`SlashCommandMenu.tsx`、`FormatCommandMenu.tsx`、`formatCommands.ts`、`LinkClickExtension.ts`、`SmartLinkExtension.ts`、`WikiLinkPreview.tsx`
- `packages/ui/src/components/Sidebar.tsx`
- `apps/desktop/src/`：`App.tsx`、`store/actions.ts`（`createChildPage` / `turnBlockIntoChildPage`）、`components/BacklinksPanel.tsx`、`components/Breadcrumb.tsx`、`lib/linkRewrite.ts`、`lib/pageLink.ts`

### 已知限制 / 未决
- **Paired 重命名级联不完整**：`A.md` → `B.md` 只重命名文件，`[[A/child]]` 这类内层引用未重写
- **Stem 歧义**：工作区内多个同名 `Foo.md` 时 `[[Foo]]` 不参与重写（按设计），需要提示 UI
- **Turn into page 选择收敛**：跨多块选择只提升 `$from` 所在的一块
- **Breadcrumb 无 paired 的中间段**：目前非可点击（没有 sidebar reveal API）
- **Hover 预览读整文件**：大文件会短暂卡 loader（有 16 项 LRU）
- **测试缺口**：`BacklinksPanel` / `Breadcrumb` 视图层无单测；`pageLink.test.ts` 有一条 Windows 路径归一化 case 预先失败（与本分支无关）
- **真机 UI 未系统走查**：所有 agent 只跑了 `tsc` + vitest，没在 `pnpm dev:desktop` 里完整点一遍

### 下一步建议
1. 在 `pnpm dev:desktop` 里走一遍黄金路径：`/page` → 重命名父页 → 看子页引用是否自动改 → 反链面板 → hover 预览
2. 补 paired folder 级联重命名（`renameMarkdownFile` 加一步：如果有同名 folder，`[[A/*]]` 一并重写）
3. 决定是否把 `subpage-v1.1` 整理成一个 PR 提回 upstream；当前 commit message 已是独立 PR 格式
4. 跑 `pnpm check:react-compiler` 确认新组件（`WikiLinkPreview`、`BacklinksPanel`、`Breadcrumb`）未被 compiler 跳过
