# GitHub Release 自动化设计

## 目标

为 LMD 建立可重复的 GitHub Release 流程，并发布当前 UI、文件拖拽和按需工具面板改动为 `0.1.1`。

## 范围

- 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本为 `0.1.1`。
- 新增 GitHub Actions 工作流，在推送语义版本标签时运行。
- 使用 GitHub 托管 macOS runner 构建 ARM64 Tauri 应用。
- 创建公开、非预发布的 GitHub Release，并上传 `.app` 与 `.dmg` 产物。
- Release 使用自动生成的变更说明，并补充本版本重点与未签名、未公证提示。

## 不在范围内

- Windows、Linux 与 Intel macOS 构建。
- Apple Developer ID 签名、公证和自动更新签名。
- App Store 分发。

## 工作流

1. 开发分支通过前端构建、Playwright 和 Rust 测试。
2. 当前修改以 `release: 0.1.1` 提交到 `master`。
3. 创建并推送 `0.1.1` 标签。
4. GitHub Actions 检出标签，安装 Node 与 Rust ARM64 目标，执行锁文件依赖安装。
5. `tauri-apps/tauri-action@v1` 构建应用、创建公开 Release 并上传产物。

## 权限与安全

- 工作流仅申请 `contents: write`，用于创建 Release 和上传附件。
- 使用 GitHub 自动提供的 `GITHUB_TOKEN`，不新增长期凭据。
- 构建使用仓库锁文件，前端依赖通过 `npm ci` 安装。
- Release 明确标注产物未签名、未公证，用户可能需要通过 Finder 手动确认首次打开。

## 失败处理

- 测试或本地发布构建失败时，不创建标签、不推送。
- GitHub Actions 构建失败时保留标签和失败日志，不宣称 Release 完成；修复后重新发布新补丁版本，避免移动已公开标签。
- 只有 GitHub Release 页面可访问且包含安装附件时，发布才算完成。

## 验收标准

- 仓库版本统一为 `0.1.1`。
- `npm run build`、`npm run test:e2e`、`cargo test` 和本地 `npm run tauri build` 成功。
- `master` 与 `0.1.1` 标签成功推送至 `origin`。
- GitHub Release `0.1.1` 为公开状态，至少包含 ARM64 macOS `.dmg` 安装包。
