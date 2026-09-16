# 分支与发布规范

适用于 `github.com/shenhuanjie/mwi-electron-desktop` 仓库的 Git Flow 子集。

## 分支模型

| 分支 | 角色 | 来源 | 合并到 | 是否受保护 | CI 触发 |
|---|---|---|---|---|---|
| `main` | 稳定发布，每个 commit 对应一个 release | 仅接受 hotfix/feature/fix 的 PR merge | 不主动写 | 是：必 PR + 必 review + 必 status check + 线性历史 | 触发：构建 + 上传 release artifact |
| `develop` | 集成开发分支，常驻 | 唯一入口：feature/fix PR | 不主动写 | 是：必 PR + 必 review + status check | 触发：构建（不打 release artifact） |
| `feature/<scope>` | 单功能开发分支 | 从 `develop` | merge 回 `develop` | 否（开发分支） | 触发：构建（验证，不出 release） |
| `fix/<scope>` | 普通缺陷修复 | 从 `develop` | merge 回 `develop` | 否 | 是 |
| `hotfix/<scope>` | 紧急修复线上版本 | 从 `main` | 同时 merge 回 `main` 和 `develop` | 否 | 触发：构建 + 主分支打 patch release |
| `release/<v<>>` | 发布准备（版本号锁定 + changelog 收尾） | 从 `develop` | merge 回 `main`（打 tag）+ `develop`（同步后续） | 否 | 触发：完整构建（Linux + 手动 macOS/Windows） |

`<scope>` 用 kebab-case 英文短语（不用中文），如 `feature/canvas-tab-drag`、`hotfix/mihomo-decode-error`。

## commit message 规范（Conventional Commits）

格式：
```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type** 必填，从固定列表取
- **subject** 中文一句话，不超过 50 字，不带句号
- **body** 可选，换行 + 详述动机/取舍/反触发，留空也行
- **footer** 可选，关联 issue / 触发 BREAKING CHANGE

允许的 type：

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `refactor` | 重构（不改行为） |
| `perf` | 性能优化 |
| `docs` | 文档变更 |
| `test` | 测试增删 |
| `build` | 构建系统 / 依赖变更（npm / electron-builder 等） |
| `ci` | CI 配置变更（GitHub Actions workflow） |
| `chore` | 杂项（不影响构建/测试） |
| `style` | 格式调整（不改逻辑）） |
| `revert` | 回滚 |

BREAKING CHANGE 在 footer 单独一行 `BREAKING CHANGE: <说明>`。

## 标签与版本（semver）

版本号 `vMAJOR.MINOR.PATCH`，在 `main` 分支按以下规则 bump：

- `MAJOR`：破坏性改动（electron / electron-builder 主版本升级、UI 协议变更）
- `MINOR`：新功能（新增 tab 类型、新增 multi-account 模式等）
- `PATCH`：bug 修复 / 依赖安全更新 / 文档 / 重构

在 `main` 分支打 tag（GitHub Releases 创建 release + tag + 上传 artifact，由 release workflow 自动完成）。

## 发布流程（4 端部署）

1. `release/vX.Y.Z` 从 `develop` 切出，bump package.json 版本号，收尾 CHANGELOG，commit `chore(release): vX.Y.Z`
2. PR：`release/vX.Y.Z` -> `main`，触发 pr-check 门禁；status check 必须通过
3. PR merge 后自动触发 release workflow（GitHub Actions，matrix 三平台构建）：
   - Linux AppImage / Windows nsis / macOS dmg+zip 统一上传到 `vX.Y.Z` GitHub Release
   - latest*.yml 随 Release 附件发布，作为 electron-updater feed
   - macOS 当前不签名不公证（签名/公证属阶段 2 投入）
4. tag 由 release workflow 自动打在 merge commit 上

## hotfix 流程

1. 从 `main` 切 `hotfix/<scope>` 分支
2. commit `fix(<scope>): <description>`
3. PR -> `main`，必 review（最少 1 人）+ status check
4. merge 后自动 patch version bump（`X.Y.(Z+1)`），release workflow 打新 tag + GitHub Release
5. 同步 PR：把 `hotfix/<scope>` merge 回 `develop`（rebase 或 fast-forward）

## PR 规范

- PR 标题 = squash commit message，遵循 Conventional Commits
- PR body 必须包含：
  - 改了什么（1-3 行）
  - 为什么这么改（动机）
  - 验证方式（怎么测过：node:test / E2E / 手动）
  - 影响范围（哪些用户/模块感知）
- PR 大小：单 PR 不超过 800 行 diff（含新增文件）
- 必填 reviewer 至少 1 人；hotfix/release 至少 1 个仓库管理员

## 禁止事项

- 禁止直接 push 到 `main` / `develop`
- 禁止 `git push --force` 到任何受保护分支
- 禁止在 feature 分支混合多个不相关改动
- 禁止 merge commit 信息写成 `merge branch 'xxx'`，用 squash
- 禁止 commit 信息带 emoji（与项目文档风格一致）

## GitHub 配置落地清单

在仓库 Settings 中配置（需仓库管理员权限）：

1. **main 分支保护**（Settings → Branches → Add branch ruleset，rule=`main`）：
   - Require a pull request before merging（Required approvals = 1）
   - Require status checks to pass（pr-check workflow 必过）
   - Require linear history
   - Block force pushes

2. **develop 分支保护**（rule=`develop`）：
   - Require a pull request before merging（Required approvals = 1）
   - Require status checks to pass
   - Block force pushes
   - **不强制** 线性历史（feature rebase 由开发者按需）

3. **PR 合并设置**（Settings → General → Pull Requests）：
   - Allow squash merging（默认 commit 信息 = PR 标题，符合 Conventional Commits）
   - Allow rebase merging
   - 关闭 Allow merge commits（强制 squash/rebase）

4. **Actions 权限**（Settings → Actions → General，已配置）：
   - Actions permissions = Allow all actions
   - Workflow permissions = Read and write（release 附件上传需要）

## GitHub Actions 工作流规划

`.cnb.yml` 已随 CNB 旧仓库退役删除，CI 能力由 GitHub Actions 承接（实施见 ISSUE-251）：

- **pr-check workflow**：PR 触发，install + unit-test + 覆盖率门禁（lines ≥ 60% / diffLines ≥ 70%），作为 main 分支保护的 status check。
- **release workflow**：`release/vX.Y.Z` 合并 `main` 触发，matrix 三平台构建——linux(AppImage) / windows(nsis) / mac(dmg+zip，当前不签名)——产物统一挂到 GitHub Releases 对应 `vX.Y.Z` Release，latest*.yml 随附件发布。

## 落地顺序（建议）

1. **写本文档**（已完成）
2. **配 PR 模板** `.github/PULL_REQUEST_TEMPLATE.md`（自动填充 PR body 模板）
3. **配 commit template** `.gitmessage`（`git config commit.template .gitmessage`）
4. **配 GitHub main 分支保护**（需仓库管理员在 Settings 操作，ISSUE-251 前置）
5. **配 PR 合并设置**（同 4）
6. **落地 GHA pr-check / release workflow**（ISSUE-251）
7. **electron-updater feed 验证**（GitHub Releases 附件 URL 公开可 GET，ISSUE-251）
8. **加 PR body lint**（可选，PR body 必须含验证方式）