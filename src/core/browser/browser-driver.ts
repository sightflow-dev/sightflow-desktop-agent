// src/core/browser/browser-driver.ts
// BrowserDriver —— BrowserSurface 与具体浏览器引擎之间的解耦接口。
//
// 设计要点（呼应 roadmap：开源的「手」插进来，自建的是动作空间 + 接地/记忆）：
// BrowserSurface 的「脑」(元素编号、语义再接地、动作→调用映射) 与「引擎」(Playwright)
// 分离。脑是纯逻辑、可用 fake driver 单测；引擎是可替换适配器。
//
// PlaywrightBrowserDriver 是真实适配器：playwright-core 为可选依赖，运行时按需 import，
// 没装时给出清晰报错。本环境无显示器无法跑真实浏览器，故该适配器为「已实现、待真机验证」。

/** driver 抓取的原始 DOM 元素（未编号） */
export interface RawDomElement {
  role: string
  name: string
  value?: string
  bbox?: [number, number, number, number]
  /** 执行用选择器（driver 自己保证可定位） */
  selector: string
  attributes?: Record<string, string>
}

export interface BrowserSnapshot {
  url: string
  title: string
  screenshotBase64?: string
  elements: RawDomElement[]
}

/** 浏览器引擎需要提供的最小能力集（BrowserSurface 只依赖这些） */
export interface BrowserDriver {
  goto(url: string): Promise<void>
  snapshot(options?: { screenshot?: boolean }): Promise<BrowserSnapshot>
  clickSelector(selector: string): Promise<void>
  fillSelector(selector: string, text: string): Promise<void>
  pressKey(key: string): Promise<void>
  scroll(dx: number, dy: number): Promise<void>
  close(): Promise<void>
}

// ── Playwright 适配器（可选依赖，懒加载） ──

interface PwPage {
  goto(url: string): Promise<unknown>
  url(): string
  title(): Promise<string>
  screenshot(opts?: { type?: string }): Promise<Buffer>
  click(selector: string): Promise<void>
  fill(selector: string, value: string): Promise<void>
  keyboard: { press(key: string): Promise<void> }
  mouse: { wheel(dx: number, dy: number): Promise<void> }
  evaluate<T>(fn: string): Promise<T>
}

interface PwBrowser {
  newPage(): Promise<PwPage>
  close(): Promise<void>
}

interface PwChromium {
  launch(opts?: { headless?: boolean }): Promise<PwBrowser>
}

/**
 * 浏览器内执行的元素抓取脚本：收集可交互元素的 role/name/bbox + 生成稳定 selector。
 * 作为字符串传给 page.evaluate，避免在主进程 bundle 里耦合浏览器上下文代码。
 */
const COLLECT_ELEMENTS_SCRIPT = `(() => {
  const SEL = 'a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=checkbox],[onclick],[contenteditable=true]';
  const out = [];
  let i = 0;
  document.querySelectorAll(SEL).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 120);
    el.setAttribute('data-sf-idx', String(i));
    out.push({
      role,
      name,
      value: el.value,
      bbox: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
      selector: '[data-sf-idx="' + i + '"]',
      attributes: { type: el.getAttribute('type') || '' }
    });
    i++;
  });
  return out;
})()`

/**
 * 真实 Playwright 适配器。playwright-core 是可选依赖，运行时按需加载。
 * 用 `import(expr as string)` 规避编译期模块解析，使未安装时也能 typecheck/打包。
 */
export class PlaywrightBrowserDriver implements BrowserDriver {
  private browser: PwBrowser | null = null
  private page: PwPage | null = null

  constructor(private readonly options: { headless?: boolean } = {}) {}

  private async ensurePage(): Promise<PwPage> {
    if (this.page) return this.page
    const specifier = 'playwright-core'
    let mod: { chromium: PwChromium }
    try {
      mod = (await import(specifier as string)) as unknown as { chromium: PwChromium }
    } catch {
      throw new Error(
        'playwright-core 未安装。启用浏览器操作面请先：npm i playwright-core && npx playwright install chromium'
      )
    }
    this.browser = await mod.chromium.launch({ headless: this.options.headless ?? false })
    this.page = await this.browser.newPage()
    return this.page
  }

  async goto(url: string): Promise<void> {
    const page = await this.ensurePage()
    await page.goto(url)
  }

  async snapshot(options?: { screenshot?: boolean }): Promise<BrowserSnapshot> {
    const page = await this.ensurePage()
    const elements = await page.evaluate<RawDomElement[]>(COLLECT_ELEMENTS_SCRIPT)
    let screenshotBase64: string | undefined
    if (options?.screenshot) {
      const buf = await page.screenshot({ type: 'png' })
      screenshotBase64 = `data:image/png;base64,${buf.toString('base64')}`
    }
    return { url: page.url(), title: await page.title(), screenshotBase64, elements }
  }

  async clickSelector(selector: string): Promise<void> {
    const page = await this.ensurePage()
    await page.click(selector)
  }

  async fillSelector(selector: string, text: string): Promise<void> {
    const page = await this.ensurePage()
    await page.fill(selector, text)
  }

  async pressKey(key: string): Promise<void> {
    const page = await this.ensurePage()
    await page.keyboard.press(key)
  }

  async scroll(dx: number, dy: number): Promise<void> {
    const page = await this.ensurePage()
    await page.mouse.wheel(dx, dy)
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
    this.page = null
  }
}
