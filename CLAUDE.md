# mwi-electron-desktop 开发约定

Electron 桌面端多账号浏览器。仓库采用 **GitHub Flow 单主干模式**：`main` 是唯一长期分支（2026-09-20 起，develop 已删除）。

## 分支与合入（必读）

- **禁止直推 `main`**：所有变更（功能 / 修复 / 重构 / 文档 / CI）一律走「任务分支 → PR → CI 绿 → 合并」。本地 pre-push 钩子会拦截直推，首次 clone 后执行一次 `git config core.hooksPath .githooks` 启用
- 任务分支命名：`feat/<scope>`、`fix/<scope>`、`chore/<scope>`、`hotfix/<scope>`，scope 用 kebab-case 英文短语
- PR 要求：
  - 标题遵循 Conventional Commits（`type(scope): 中文一句话`）
  - 标注来源 issue；无 issue 时说明来源
  - **评审自测结论必须写进 PR 描述**（跑了什么测试、命令、结果）
  - 单 PR 不超过 800 行 diff（批次 / 迁移类除外，需说明）
- CI 门禁（pr-check workflow）：单测全过 + 全局行覆盖 ≥55% + PR 变更行覆盖 ≥58%（阈值以 `.github/workflows/pr-check.yml` 为准），不绿不合

## 常用命令

```bash
npm test                    # 全量单测（tests/** 与 lib/__tests__/**）
npm run dev                 # 开发启动（自动 build icons + fetch mihomo）
npm run dist:<platform>     # 打包（linux / win / mac）
```

与 CI 同款的覆盖率门禁命令见 `.github/workflows/pr-check.yml`。

## 仓库注意事项

- **Windows 路径兼容**：凡涉及文件路径匹配的测试 mock 与脚本，必须先做 `\` → `/` 归一化再比对（历史上两次踩坑：测试 Module._load 拦截正则、coverage-diff-gate 的 c8 报告键匹配）
- mihomo 二进制不入库：启动 / 打包前由 `scripts/fetch-mihomo.mjs` 自动从 GitHub Releases 拉取
- 运行时数据存于 `userData/`，不入库；`coverage/` 为测试产物，不入库
- 发布：合并标题为 `chore(release): vX.Y.Z` 的 PR 到 main 后自动触发三平台构建并发布 GitHub Release，package.json 的 version 必须与发布号一致；详见 `docs/git-workflow.md`
