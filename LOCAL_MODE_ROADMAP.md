# Local-Mode 螺旋式迭代开发路线图

为了避免一次性堆砌大量底层模块导致难以排查（特别是 macOS 原生调用容易引发的全盘假死），我们将 Local-Mode 分解为 6 个“可独立运行、可独立验证”的小螺旋阶段。

每个阶段都有明确的**目标**和**验收标准（独立测试脚本）**，最后阶段只需将它们无缝拼合。

---

## Spiral 1: 神经中枢贯通 (UI-Engine 数据与日志闭环)

**目标**：打通 Electron 主进程引擎与 React 渲染层的前后端通讯，不需要真实的微信，只用 `MockDevice` 让业务逻辑先跑起来。
*   **具体步骤**：
    1. 在 `LocalHooks` 与 `Engine` 中通过 IPC 事件推送机制（如引入简单的 `EventEmitter` 封装）发送状态。
    2. 主进程的 `engine:start` 获取到实时日志流，并转发给 UI。
    3. UI 的 Log 组件实时打印：`[感知] 等待消息...` -> `[AI] 开始思考...` -> `[执行] 模拟发送回复`。
*   **验收标准**：点击 UI 上的**[开始]**按钮，不需要真实的微信和真实的大模型（大模型可以直接被 stub），控制台能每隔 3 秒稳健刷出标准的执行流日志。

## Spiral 2: 隔离的安全感知模块 (Safe Perception)

**目标**：彻底解决主线程读取系统窗口信息时死锁的顽疾，实现一个纯净、非阻塞的窗口状态获取和局部截图模块。
*   **具体步骤**：
    1. 抛弃传统的 `main` 进程同步调用 `active-win` 或长轮询 `desktopCapturer`。
    2. 写一个独立的辅助脚本或利用 `Node child_process (spawn)` / AppleScript。
    3. 实现 `getWeChatWindowBounds()` 拿到真实的 x, y, w, h。
    4. 实现 `captureWindow(bounds)` 实现局部精确截图并压缩成 JPEG/Base64。
*   **验收标准**：写一个单纯的测试脚本 `ts-node src/test/test-perception.ts`，运行后能在不卡死系统的前提下，在 `output/` 文件夹准确吐出一张刚好框住当前微信页面的截图，以及它的系统坐标。

## Spiral 3: 轻量视觉心跳算法 (Vision Heartbeat)

**目标**：基于截下来的局部图片，用最低效能消耗、百分百非挂起的方式判断“微信是不是来了新消息”。
*   **具体步骤**：
    1. 引入轻量的图像像素扫描库（如 `jimp`）或者纯数学计算对比库。
    2. 实现特定区域的高亮 / 红点特征匹配：函数 `isUnread(imageBuffer): boolean` 对象。
    3. 如果视觉实现困难，引入折中方案：检测右侧聊天区域最底下一条气泡的颜色特征（如果是绿色则证明最后一句是自己说的，静默跳过）。
*   **验收标准**：提供两张测试图片（一张是有新消息的微信截图，一张是没有的），运行纯函数 `test-vision.ts` 瞬间输出 `true/false`。

## Spiral 4: 本地大模型视觉中枢 (AI Vision Brain)

**目标**：将 Vercel AI SDK 接入多模态能力，并且编写防止自我纠缠循环（Anti-Loop）的 Prompt 系统指令。
*   **具体步骤**：
    1. 填充 `ai-client.ts`，配置支持传入 `message.content: [{type: 'image'}]` 的格式。
    2. 制定 System Prompt (如：“图片是一张微信聊天记录。若最后一句是你自己发送的，强行输出 `[SKIP]`；否则请归纳语境并直接提供回复文本，不要带废话”。)
    3. 在 `LocalHooks.getReply` 端进行组装。
*   **验收标准**：输入截好的历史聊天图片，单独运行 `test-ai.ts` 能在终端打印出合理的分析以及输出流 `AsyncIterable<ReplyAction>`。

## Spiral 5: 隔离的安全键鼠模块 (Safe Action)

**目标**：同感知层，我们将 `robotjs` 的操控层剥离到绝对不会污染主 Electron Event Loop 的子进程中。
*   **具体步骤**：
    1. 实现极其精简的子进程 IPC 指令流：接受 `['click', x, y]`, `['write_clipboard', text]`, `['combo', 'v', 'command']`, `['combo', 'enter']` 的原子动作序列。
    2. 只有在这个完全独立的进程中才调用老旧容易阻塞的 C++ 原生扩展。
*   **验收标准**：打开一个系统记事本放到后台，运行调试脚本 `test-action.ts`，能看到光标自动激活记事本 -> 粘贴特定文字 -> 归位，整个过程流畅无阻塞。

## Spiral 6: 系统无缝闭环接站 (Stitching: True WeChatDevice)

**目标**：水到渠成，完成 `MockDevice` 到真实 `WeChatDevice` 的最终替换。
*   **具体步骤**：
    1. 将 **Spiral 2** 和 **Spiral 3** 的能力对接填入 `WeChatDevice.screenshot()`, `findWindow()`, `hasUnreadMessage()`。
    2. 将 **Spiral 5** 填入 `click()`, `sendMessage()` 等。
    3. `Engine` 换上 `WeChatDevice`。
*   **验收标准**：这就是最终交付时刻，点击界面“开始”，拿小号给当前微信发送一条消息。不仅不会造成 Mac 风火轮卡死，桌面应用还将平稳输出状态变化并将你的回复发送至输入框。
