// dev 启动入口 —— 确保 Windows 终端在拉起 electron-vite 之前处于 UTF-8 代码页
// 背景：electron-vite dev 会用 pipe 接管 Electron 主进程 stdout，在主进程里 chcp
// 改不到真实终端；必须在 npm 启动链最外层（本脚本）先把当前 cmd 的代码页切到 65001，
// 这样后续派生的 electron-vite / electron 子进程的 UTF-8 输出才能被终端正确渲染。

import { execSync, spawn } from 'node:child_process'

if (process.platform === 'win32') {
  try {
    // 本脚本作为 npm run dev 的子进程，继承了 npm 的 cmd，而 npm 的 cmd 继承了用户终端，
    // 共享同一个 console。在这里执行 chcp 会改到那个共享 console 的输出代码页。
    execSync('chcp 65001', { stdio: ['ignore', 'ignore', 'inherit'] })
  } catch {
    // 非 cmd 环境（如 MINGW / Git Bash）拿不到 chcp，忽略
  }
}

const child = spawn('electron-vite', ['dev'], {
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
