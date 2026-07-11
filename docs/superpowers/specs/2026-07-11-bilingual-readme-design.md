# LMD 双语 README 设计

## 目标

重写项目对外文档，使 GitHub 首页准确表达 LMD 作为本地优先 Markdown 笔记、知识管理和 AI 辅助 Wiki 工具的当前能力，并为中文用户提供完整、独立的说明。

## 文档结构

### `README.md`

英文作为 GitHub 默认首页，顶部提供 `English | 简体中文` 语言切换。内容按以下顺序组织：

1. 产品名称、定位与当前平台状态。
2. `0.1.1` macOS ARM64 Release 下载入口和未签名提示。
3. 三张当前界面截图。
4. 核心工作流：Markdown、本地工作区、知识管理、AI 到 Wiki 草稿。
5. 已实现功能，按 Editing、Knowledge、AI、Export 分组。
6. 安装与首次打开说明。
7. 本地开发、测试与打包。
8. 已知限制、路线图和贡献入口。

### `README.zh-CN.md`

提供与英文首页等价的完整中文内容，而不是摘要。章节、链接、命令、截图和事实保持同步；仅文案语言不同。

## 产品叙事

首屏定位采用三层表达：

- 本地优先：Markdown 文件保留在用户选择的文件夹中，不迁移进专有数据库。
- 知识管理：工作区索引、Wiki 链接、反向链接、块引用、标签、Front Matter 和 Wiki Inbox。
- AI 辅助：基于当前笔记与工作区上下文生成内容，并保存为可审阅的本地 Markdown Wiki 草稿。

不将后续规划中的知识控制台、语义搜索、来源可信度或 Wiki 审核状态写成现有功能。

## 截图

替换过时的 `docs/assets/lmd-editor.png`，使用当前 `0.1.1` 界面重新采集：

1. `docs/assets/lmd-editor.png`：工作区、编辑器与预览的主界面。
2. `docs/assets/lmd-ai-assistant.png`：覆盖式 AI 抽屉与三项主快捷动作。
3. `docs/assets/lmd-command-palette.png`：命令面板及功能发现入口。

截图要求：

- 使用相同桌面视口和浅色主题。
- 不包含 API Key、真实个人路径或用户数据。
- 展示当前代码实际渲染的界面，不制作概念图。
- 每张截图写入仓库后重新打开检查，拒绝空白、裁切或过时状态。

## 安装说明

- 主要下载入口链接至 GitHub Release `0.1.1`。
- 明确当前 Release 提供 macOS ARM64 产物。
- 明确安装包尚未签名或公证，并说明 Finder 右键“打开”的首次启动方法。
- 不声称支持 Windows、Linux、Intel macOS 或自动更新。

## 开发与验证说明

- 使用 `npm install`、`npm run tauri:dev`、`npm run build`、`npm run test:e2e`、`cargo test` 和 `npm run tauri build`。
- 本地构建产物使用 `0.1.1`，文件名按实际主机架构变化，不硬编码为 ARM64。
- 保留 QA、Roadmap、Security、Contributing、Changelog 和 License 链接。

## 验收标准

- GitHub 默认首页为英文，顶部可切换到完整中文说明。
- 两份 README 的产品能力、安装命令和限制一致。
- 不再出现旧常驻检查器截图或 `0.1.0` 构建路径。
- 三张截图均来自当前界面并经过视觉检查。
- README 中所有仓库内链接有效，Release URL 可访问。
- Markdown 格式检查和项目构建通过。
