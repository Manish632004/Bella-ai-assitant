/**
 * Semantic Browser Automation Controller via Playwright
 * Prioritizes DOM/ARIA/Semantic selectors over coordinates.
 */

import { chromium, Browser, BrowserContext, Page, Locator } from "playwright";
import path from "path";
import fs from "fs";
import {
  ActionResult,
  ComputerAction,
  SemanticSelector,
  PageContentSummary,
  DOMInspectionResult,
  Coordinates,
} from "../types";

export class BrowserController {
  private static browser: Browser | null = null;
  private static context: BrowserContext | null = null;
  private static page: Page | null = null;
  private static isInitializing = false;

  private static async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (this.page && !this.page.isClosed()) return this.page;
    }

    this.isInitializing = true;
    try {
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await chromium.launch({
          headless: false,
          args: ["--start-maximized", "--no-sandbox", "--disable-blink-features=AutomationControlled"],
        });
      }

      if (!this.context) {
        this.context = await this.browser.newContext({
          viewport: null, // Natural maximized screen size
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        });
      }

      const pages = this.context.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        this.page = pages[0];
      } else {
        this.page = await this.context.newPage();
      }

      return this.page;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Resolves target into a Playwright Locator using the semantic priority hierarchy:
   * 1. Accessibility role/name
   * 2. Label
   * 3. Test ID
   * 4. Stable ID
   * 5. Stable CSS selector
   * 6. Text selector
   * 7. XPath
   */
  private static resolveLocator(page: Page, target: string | SemanticSelector): Locator | null {
    if (typeof target === "string") {
      const trimmed = target.trim();
      // If it looks like an ID
      if (trimmed.startsWith("#")) {
        return page.locator(trimmed);
      }
      // If it looks like XPath
      if (trimmed.startsWith("//") || trimmed.startsWith("xpath=")) {
        return page.locator(trimmed);
      }
      // Try role or button/link by text first, then text, then CSS
      try {
        return page.getByText(trimmed, { exact: false }).first();
      } catch {
        return page.locator(trimmed).first();
      }
    }

    // SemanticSelector object
    if (target.role) {
      return page.getByRole(target.role as any, { name: target.name, exact: false }).first();
    }
    if (target.label) {
      return page.getByLabel(target.label, { exact: false }).first();
    }
    if (target.testId) {
      return page.getByTestId(target.testId).first();
    }
    if (target.id) {
      return page.locator(`#${target.id}`).first();
    }
    if (target.css) {
      return page.locator(target.css).first();
    }
    if (target.text) {
      return page.getByText(target.text, { exact: false }).first();
    }
    if (target.xpath) {
      return page.locator(target.xpath).first();
    }

    return null;
  }

  public static async navigate(rawUrl: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.navigate", target: rawUrl };
    try {
      const page = await this.ensurePage();
      const url = rawUrl.startsWith("http://") || rawUrl.startsWith("https://") || rawUrl.startsWith("about:")
        ? rawUrl
        : `https://${rawUrl}`;

      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const currentUrl = page.url();
      const title = await page.title();

      return {
        success: true,
        action,
        message: `Navigated to ${currentUrl} ("${title}")`,
        metadata: {
          url: currentUrl,
          title,
          status: response?.status() ?? 200,
        },
      };
    } catch (err: any) {
      return { success: false, action, error: `Navigation failed: ${err.message}` };
    }
  }

  public static async click(target: string | SemanticSelector, coordinates?: Coordinates): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.click", target, coordinates };
    try {
      const page = await this.ensurePage();
      const locator = this.resolveLocator(page, target);

      if (locator) {
        try {
          await locator.waitFor({ state: "visible", timeout: 5000 });
          await locator.click({ timeout: 5000 });
          return {
            success: true,
            action,
            message: `Clicked element successfully via semantic selector.`,
            metadata: { target },
          };
        } catch (locatorErr: any) {
          // If locator failed, fall back to coordinate click if provided
          if (coordinates) {
            await page.mouse.click(coordinates.x, coordinates.y);
            return {
              success: true,
              action,
              message: `Clicked coordinates (${coordinates.x}, ${coordinates.y}) as fallback.`,
              metadata: { fallback: "coordinates" },
            };
          }
          throw locatorErr;
        }
      }

      if (coordinates) {
        await page.mouse.click(coordinates.x, coordinates.y);
        return {
          success: true,
          action,
          message: `Clicked coordinates (${coordinates.x}, ${coordinates.y}).`,
        };
      }

      return { success: false, action, error: `Could not resolve selector for target: ${JSON.stringify(target)}` };
    } catch (err: any) {
      return { success: false, action, error: `Click action failed: ${err.message}` };
    }
  }

  public static async type(target: string | SemanticSelector, text: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.type", target, value: text };
    try {
      const page = await this.ensurePage();
      const locator = this.resolveLocator(page, target);

      if (!locator) {
        return { success: false, action, error: `Target input could not be found for typing.` };
      }

      await locator.waitFor({ state: "visible", timeout: 8000 });
      await locator.fill(text);

      const actualValue = await locator.inputValue().catch(() => "");
      return {
        success: true,
        action,
        message: `Typed into input successfully.`,
        metadata: { filledValue: actualValue || text },
      };
    } catch (err: any) {
      return { success: false, action, error: `Type action failed: ${err.message}` };
    }
  }

  public static async select(target: string | SemanticSelector, value: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.select", target, value };
    try {
      const page = await this.ensurePage();
      const locator = this.resolveLocator(page, target);

      if (!locator) {
        return { success: false, action, error: `Target select element could not be found.` };
      }

      await locator.waitFor({ state: "visible", timeout: 5000 });
      const selected = await locator.selectOption({ label: value }).catch(() => locator.selectOption({ value }));

      return {
        success: true,
        action,
        message: `Selected "${value}" in dropdown.`,
        metadata: { selectedOptions: selected },
      };
    } catch (err: any) {
      return { success: false, action, error: `Select action failed: ${err.message}` };
    }
  }

  public static async submit(target?: string | SemanticSelector): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.submit", target };
    try {
      const page = await this.ensurePage();

      if (target) {
        const locator = this.resolveLocator(page, target);
        if (locator) {
          await locator.click();
          return { success: true, action, message: `Submitted form via target element click.` };
        }
      }

      // Default: find submit button or press Enter
      const submitBtn = page.getByRole("button", { name: /submit|login|sign in|search|send/i }).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        return { success: true, action, message: `Submitted form by clicking submit button.` };
      }

      await page.keyboard.press("Enter");
      return { success: true, action, message: `Submitted form via Enter keypress.` };
    } catch (err: any) {
      return { success: false, action, error: `Submit action failed: ${err.message}` };
    }
  }

  public static async wait(waitType = "load", target?: string, timeoutMs = 10000): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.wait", target, parameters: { waitType, timeoutMs } };
    try {
      const page = await this.ensurePage();

      if (waitType === "element" && target) {
        const locator = this.resolveLocator(page, target);
        if (locator) {
          await locator.waitFor({ state: "visible", timeout: timeoutMs });
          return { success: true, action, message: `Element "${target}" is now visible.` };
        }
      } else if (waitType === "url" && target) {
        await page.waitForURL(new RegExp(target), { timeout: timeoutMs });
        return { success: true, action, message: `URL matched: ${page.url()}` };
      } else {
        await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
        return { success: true, action, message: `Page DOM content loaded.` };
      }

      return { success: true, action, message: `Wait completed.` };
    } catch (err: any) {
      return { success: false, action, error: `Wait condition failed: ${err.message}` };
    }
  }

  public static async inspect(): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.inspect" };
    try {
      const page = await this.ensurePage();
      const url = page.url();
      const title = await page.title();

      const interactive = await page.evaluate(() => {
        const results: any[] = [];
        const elements = document.querySelectorAll("button, a[href], input, select, textarea, [role='button']");

        elements.forEach((el, index) => {
          if (results.length >= 30) return;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== "hidden") {
            const role = el.getAttribute("role") || el.tagName.toLowerCase();
            const text = (el.textContent || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || "").trim();
            const ariaLabel = el.getAttribute("aria-label") || "";
            const id = el.id || "";

            results.push({
              index,
              role,
              name: ariaLabel || text.slice(0, 40),
              id: id ? `#${id}` : undefined,
              type: (el as HTMLInputElement).type || undefined,
            });
          }
        });
        return results;
      });

      const inspection: DOMInspectionResult = {
        url,
        title,
        interactiveElements: interactive,
      };

      return {
        success: true,
        action,
        message: `Inspected page: ${interactive.length} interactive elements found.`,
        metadata: inspection as any,
      };
    } catch (err: any) {
      return { success: false, action, error: `Inspect failed: ${err.message}` };
    }
  }

  public static async read(): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.read" };
    try {
      const page = await this.ensurePage();
      const url = page.url();
      const title = await page.title();

      const content = await page.evaluate(() => {
        const headings: string[] = [];
        document.querySelectorAll("h1, h2, h3").forEach((h) => {
          const t = h.textContent?.trim();
          if (t && headings.length < 15) headings.push(t);
        });

        const links: { text: string; href: string }[] = [];
        document.querySelectorAll("a[href]").forEach((a) => {
          const text = a.textContent?.trim();
          const href = (a as HTMLAnchorElement).href;
          if (text && href && links.length < 15 && !href.startsWith("javascript:")) {
            links.push({ text: text.slice(0, 50), href });
          }
        });

        // Extract clean visible body text without script/style tags
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script, style, noscript, svg, nav, footer").forEach((n) => n.remove());
        const rawText = clone.innerText || clone.textContent || "";
        const cleanText = rawText.replace(/\s+/g, " ").trim().slice(0, 3000);

        return { headings, links, text: cleanText };
      });

      const summary: PageContentSummary = {
        url,
        title,
        headings: content.headings,
        text: content.text,
        links: content.links,
      };

      return {
        success: true,
        action,
        message: `Read page content from ${url}`,
        metadata: summary as any,
      };
    } catch (err: any) {
      return { success: false, action, error: `Read failed: ${err.message}` };
    }
  }

  public static async download(url: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.download", target: url };
    try {
      const page = await this.ensurePage();
      const downloadPath = path.join(process.cwd(), "Downloads");
      if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
      }

      // Handle download event safely
      const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
      await page.goto(url).catch(() => {});
      const download = await downloadPromise;

      const suggestedFilename = download.suggestedFilename();
      const targetFile = path.join(downloadPath, suggestedFilename);
      await download.saveAs(targetFile);

      return {
        success: true,
        action,
        message: `Downloaded file to ${targetFile}`,
        metadata: {
          filename: suggestedFilename,
          path: targetFile,
          size: fs.statSync(targetFile).size,
        },
      };
    } catch (err: any) {
      return { success: false, action, error: `Download failed: ${err.message}` };
    }
  }

  public static async screenshot(target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "browser.screenshot", target };
    try {
      const page = await this.ensurePage();
      const downloadPath = path.join(process.cwd(), "Downloads");
      if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
      }

      const filename = `browser_screenshot_${Date.now()}.png`;
      const filePath = path.join(downloadPath, filename);

      if (target === "full") {
        await page.screenshot({ path: filePath, fullPage: true });
      } else if (target && target !== "viewport") {
        const locator = this.resolveLocator(page, target);
        if (locator) {
          await locator.screenshot({ path: filePath });
        } else {
          await page.screenshot({ path: filePath });
        }
      } else {
        await page.screenshot({ path: filePath });
      }

      return {
        success: true,
        action,
        message: `Captured browser screenshot: ${filePath}`,
        metadata: { path: filePath, filename },
      };
    } catch (err: any) {
      return { success: false, action, error: `Browser screenshot failed: ${err.message}` };
    }
  }

  public static async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}
