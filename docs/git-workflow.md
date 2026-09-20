# 分支与发布规范

适用于 `github.com/shenhuanjie/mwi-electron-desktop`。

> **2026-09-20 起收敛为 GitHub Flow 单主干模式**：`main` 是唯一长期分支，`develop` 及历史分支已删除（收敛过程见 PR #13 / #14）。本文档已按单主干重写。

## 分支模型

| 分支 | 角色 | 来源 | 合并到 | 保护 | CI |
|---|---|---|---|---|---|
| `main` | 唯一长期分支，稳定发布线 | 仅接受 PR merge | — | 暂为三层约定防线（见「直推防线」） | push 触发 pr-check；release 合并触发发布 |
| `feat/<scope>` | 新功能 | 从 `main` | PR → `main` | 否 | PR 触发 pr-check |
| `fix/<scope>` | 缺陷修复 | 从 `main` | PR → `main` | 否 | 同上 |
| `chore/<scope>` | 工程 / 文档 / CI / 依赖 | 从 `main` | PR → `main` | 否 | 同上 |
| `hotfix/<scope>` | 紧急修复线上问题 | 从 `main` | PR → `main` | 否 | 同上，合并后按 PATCH+1 走发布流程 |

`<scope>` 用 kebab-case 英文短语（不用中文），如 `feat/canvas-tab-drag`、`fix/mihomo-decode-error`。

## 直推防线（分支保护的当前替代）

私有仓库 + 免费账户无法启用 GitHub 分支保护，当前以三层组合替代：

1. **约定层**：本文件 + 仓库根 `CLAUDE.md`（对所有读仓库的 agent 生效）
2. **本地硬防线**：`.githooks/pre-push` 拦截一切对 `main` 的直推。**每个 clone 执行一次启用**：
   ```bash
   git config core.hooksPath .githooks
   ```
   绕过需显式 `git push --no-verify`（视为明知违规）
3. **事后检测层**：`main` 每次 push 都会跑 pr-check workflow，直推混入的提交无法通过门禁，红灯立现

升级 GitHub Pro 或转公开仓库后，应启用真正的分支保护（见「GitHub 配置落地清单」）。

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
| `style` | 格式调整（不改逻辑） |
| `revert` | 回滚 |

BREAKING CHANGE 在 footer 单独一行 `BREAKING CHANGE: <说明>`。

## 标签与版本（semver）

版本号 `vMAJOR.MINOR.PATCH`，在 `main` 分支按以下规则 bump：

- `MAJOR`：破坏性改动（electron / electron-builder 主版本升级、UI 协议变更）
- `MINOR`：新功能（新增 tab 类型、新增 multi-account 模式等）
- `PATCH`：bug 修复 / 依赖安全更新 / 文档 / 重构

tag 与 GitHub Release 由 release workflow 自动创建，不手动打 tag。

## 发布流程

1. 从 `main` 切 `chore/release-vX.Y.Z` 分支，`npm run bump` 后手动改 package.json `version` 为 `X.Y.Z`，commit `chore(release): vX.Y.Z`
2. PR → `main`，pr-check 必须绿
3. merge 后 release workflow 自动识别（合并信息含 `chore(release): vX.Y.Z` 且与 package.json 版本一致且 tag 不存在）→ 三平台 matrix 构建 → 产物挂到 `vX.Y.Z` GitHub Release
   - Linux AppImage / Windows nsis+portable / macOS dmg+zip（arm64+x64，当前不签名不公证）
   - `latest*.yml` 随 Release 附件发布，作为 electron-updater feed（应用内自动更新客户端待接入）
4. 也可在 Actions 手动 `workflow_dispatch` 指定版本号触发

## PR 规范

- PR 标题遵循 Conventional Commits
- PR body 必须包含：
  - 改了什么（1-3 行）
  - 为什么这么改（动机）
  - 验证方式（怎么测过：node:test / E2E / 手动）——**评审自测结论随 PR 提供**
  - 影响范围（哪些用户/模块感知）
- PR 大小：单 PR 不超过 800 行 diff（批次 / 迁移类除外，需在描述中说明）
- 合并方式：小 PR 用 squash（保持线性）；批次 / 迁移类多提交 PR 可用 merge commit 保留链路（如 PR #13/#14）

## 需求与 BUG 管理

- **GitHub Issue 是执行闭环的单一事实源**：要做/在修什么、验收标准、open/closed 状态，以 issue 为准
- 需求走「需求 / 功能建议」模板（动机 + 验收标准必填）；BUG 走「BUG 报告」模板（复现步骤 + 环境必填），模板位于 `.github/ISSUE_TEMPLATE/`
- Label 最小集：`type:feat` / `type:bug` / `type:chore` + `p0` / `p1` / `p2`（严重程度），p0=阻断使用/数据损坏、p1=主要功能受损、p2=体验问题
- 方案设计、技术选型、踩坑复盘等知识性文档归档思源笔记（PARA 项目夹 `20260831-MWI账号桌面端项目开发`），issue 与思源文档互相放链接；**执行态事实以 issue 为准，思源文档落笔即冻结**
- 修 bug 必补回归测试（先红后绿），与 CI 覆盖率门禁互为防线
- openspec 规格驱动体系已于 2026-09-20 退役，历史规格归档思源「07-历史规格归档」，不再新增 change

## 禁止事项

- 禁止直接 push 到 `main`（pre-push 钩子会拦截；`--no-verify` 绕过需自担责任）
- 禁止 `git push --force` 到 `main`
- 禁止在任务分支混合多个不相关改动
- 禁止 commit 信息带 emoji（与项目文档风格一致）

## GitHub 配置落地清单

> 以下 1~3 需 **GitHub Pro**（私有仓库）或仓库转公开后方可启用；当前为约定 + 钩子替代。

1. **main 分支保护**（Settings → Branches）：
   - Require a pull request before merging
   - Do not allow force pushes / deletions
   - Require status checks to pass，勾选 CI 门禁 job
   - **不设置** Require approvals（个人项目无第二评审人）
   - 注意：status check 名称必须与 workflow job 显示名一致（启用前建议先把 pr-check 的 job 改名为 `mwi-ci` 对齐既有约定）
2. **PR 合并设置**（Settings → General → Pull Requests）：允许 squash merge 与 merge commit
3. **Actions 权限**（已配置）：Workflow permissions = Read and write（release 附件上传需要）

## GitHub Actions 工作流

CI 能力由 GitHub Actions 承接（CNB 的 `.cnb.yml` 已退役删除；实施见 ISSUE-251）：

- **pr-check workflow**：PR 及 main push 触发，install + 全量单测 + 覆盖率门禁。阈值 2026-09-20 按实测基线校准：全局行覆盖 ≥55%、PR 变更行覆盖 ≥58%（门禁上线时 main 无插桩数据、原 60/70 从未被检验；覆盖率回升后应逐步收紧回 60/70）
- **release workflow**：见「发布流程」，detect job 三重校验（合并信息版本 = package.json 版本、tag 不存在），非发布提交约 10 秒跳过

## 待办（按优先级）

1. electron-updater 客户端接入（feed 服务端已就绪：latest*.yml 已随 Release 发布）
2. pr-check 增加 `npm audit --audit-level=high` 依赖安全门禁
3. pr-check 测试 job 增加 windows 平台矩阵（或每周定时跨平台测试）
4. 启用 GitHub 分支保护（依赖 Pro / 公开；启用前先统一 job 名 `mwi-ci`）
