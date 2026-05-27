[**English**](CONTRIBUTING.md) | [**简体中文**](CONTRIBUTING.zh.md)

# 贡献指南

首先安装以下工具：

- [Task](https://taskfile.dev)（macOS: `brew install go-task`）
- Node.js 22
- Yarn

从根目录开始：

```bash
git clone https://github.com/browser-use/desktop.git
cd desktop
task up
```

`task up` 会安装依赖、修补本地 Electron 应用包并启动桌面应用。

常用开发命令：

```bash
task --list          # 查看所有可用任务
task lint            # 运行 ESLint
task typecheck       # 运行 tsc --noEmit
cd app && yarn test  # 运行单元测试和集成测试
task make            # 构建平台安装包
```

Linux 包在 Docker 中构建：

```bash
task linux:make:docker
```

## Pull Request 规范

优秀的 PR 应聚焦且易于审查：

1. 说明为什么需要这个改动。
2. 将 PR 范围限定在一个 bug 修复、功能或清理上。
3. UI 改动请附带截图或简短录屏。

在 Discord、Twitter 或邮件中联系 Browser Use 团队成员，可加快 PR 审查速度。

## 报告 Bug

在 [browser-use/desktop/issues](https://github.com/browser-use/desktop/issues) 创建 issue，提供足够细节以便他人复现。

良好的 Bug 报告包括：

- 应用版本 / git commit
- 您的操作系统
- 您使用的提供商（如 Claude Code 或 Codex）
- 复现问题的清晰步骤
- 期望结果与实际结果
- Bug 可见时的截图或录屏
- 相关日志（请打码密钥和私有 URL）

有用的日志命令：

```bash
task logs:all
task logs:app
task logs:browser
task logs:agent SESSION_ID=<会话ID>
task logs:engine
task logs:errors
```

默认日志路径：

```text
~/Library/Application Support/Browser Use/logs
```

## 功能请求

请同时描述问题和解决方案！包括：

- 当前应用为何无法很好解决该问题
- 您期望的具体成果
- 截图、录屏或示例网站（如有助说明）

如果您打算为该功能提交 PR，请先创建 issue！并在 PR 中关联该 issue。

## 国际化（i18n）

本应用内置简体中文和英文界面。所有 UI 字符串采用 **key = fallback** 模式——英文原文即翻译键，缺失的键会优雅地回退为英文。

### 添加或编辑字符串

1. 修改组件——用 `t('...')`（React 组件内）或 `i18n.t('...')`（模块级代码）包裹面向用户的字符串。
2. 将英文键添加到 `app/src/renderer/locales/en.json`（值 = 键）。
3. 将对应翻译添加到 `app/src/renderer/locales/zh.json`（或您要添加的语言）。
4. 运行 `cd app && task typecheck` 验证。

### 添加新语言

1. 根据 `en.json` 创建 `app/src/renderer/locales/{语言}.json`，包含所有键。
2. 在 `app/src/renderer/hub/SettingsPane.tsx` 的语言下拉框中添加新语言选项。
3. 提交 PR——每次只添加一种语言。

### 文件结构

```
app/src/renderer/
  i18n.ts                 # i18next 初始化
  locales/
    en.json               # 英文源字符串
    zh.json               # 简体中文翻译
```

### 在新文件中使用 i18n

- **React 组件：** 从 `react-i18next` 导入 `useTranslation`，调用 `t()` 函数。
- **模块级代码（组件外）：** 根据文件深度从相对路径导入 `i18n`（如 `../i18n` 或 `../../i18n`），调用 `i18n.t()`。
- 全部 5 个渲染进程入口（`hub/`、`onboarding/`、`pill/`、`popup/`、`logs/`）已包裹 `<I18nextProvider>`，内部的任何组件均可使用该 hook。

## 提问

[Browser Use Discord](https://discord.com/invite/fqPB2NCNKV)
[Twitter](https://x.com/browser_use)
