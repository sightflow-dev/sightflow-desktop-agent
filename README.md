# SightFlow.dev
<img width="1201" height="495" alt="image" src="https://github.com/user-attachments/assets/99a7cfec-eb22-4f65-8a76-a6974e46bcf0" />

Official website： [https://sightflow.dev](https://sightflow.dev/)

## 🔑 AI 模型配置 (API Key / SK Key)

本项目依赖大语言模型/视觉模型（Vision Language Model）驱动 RPA。
目前默认内置使用了**火山引擎 (Volcengine)** 的大模型服务。

### SK Key 的用途
1. **智能对话回复**：由于项目涉及类似微信等的自动抓取，模型会分析聊天界面的截图并生成自然的回复内容（带防止自我循环对话机制）。
2. **VLM 视觉定位引导**：基于屏幕截图和特定 Prompt，让模型自动检测屏幕上的 UI 控件，并返回需要点击的坐标，从而驱动纯视觉的 RPA 流程。

### 如何配置
1. 请前往 [火山引擎控制台 - 方舟原生接口](https://console.volcengine.com/ark) 开通相关服务（如 doubao-seed-2-0-lite），并生成/获取你的 API Key。
2. 在项目启动后，点击页面上的**设置 (Settings)** 选项。
3. 将你的 API Key 填入配置中，即可开始测试对应 AI 功能及自动回复了（默认的 Base URL 为 `https://ark.cn-beijing.volces.com/api/v3` 可以直接使用不变）。

## 🚀 快速开始 (Project Setup)

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发运行

```bash
npm run dev
```
> **提示**：启动后，应用将打开主界面。请记得先去设置填入 skkey 再进行后续测试。

## 📦 打包构建 (Build)

```bash
# 构建 Windows 版本
npm run build:win

# 构建 macOS 版本
npm run build:mac

```

## 开发环境推荐配置

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
