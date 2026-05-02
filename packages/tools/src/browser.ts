import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import WebSocket from "ws";

export interface BrowserPageElement {
  readonly elementId: string;
  readonly tag: string;
  readonly text: string;
  readonly selector: string;
  readonly type?: string;
  readonly href?: string;
  readonly value?: string;
}

export interface BrowserPageSnapshot {
  readonly title: string;
  readonly url: string;
  readonly text: string;
  readonly elements: readonly BrowserPageElement[];
  readonly loadedAt: string;
}

export type BrowserObservationKind = "console" | "request-failure";

export interface BrowserObservation {
  readonly kind: BrowserObservationKind;
  readonly timestamp: string;
  readonly message: string;
  readonly level?: string;
  readonly url?: string;
  readonly method?: string;
  readonly errorText?: string;
}

export interface BrowserSessionState {
  readonly id: string;
  readonly lastSnapshot: BrowserPageSnapshot;
  readonly observations: readonly BrowserObservation[];
  readonly diagnostics: readonly BrowserObservation[];
}

export interface BrowserScreenshotCapture {
  readonly dataBase64: string;
  readonly mimeType: "image/png";
  readonly capturedAt: string;
}

export interface BrowserScreenshotState extends BrowserSessionState {
  readonly screenshot: BrowserScreenshotCapture;
}

export interface BrowserAutomationSession {
  navigate(url: string): Promise<BrowserPageSnapshot>;
  snapshot(maxChars?: number): Promise<BrowserPageSnapshot>;
  screenshot(): Promise<BrowserScreenshotCapture>;
  click(input: { readonly selector?: string; readonly elementId?: string; readonly waitForLoad?: boolean }): Promise<BrowserPageSnapshot>;
  type(input: {
    readonly selector?: string;
    readonly elementId?: string;
    readonly text: string;
    readonly submit?: boolean;
  }): Promise<BrowserPageSnapshot>;
  diagnostics?(): readonly BrowserObservation[];
  close(): Promise<void>;
}

export interface BrowserAutomationAdapter {
  createSession(input: { readonly headless: boolean; readonly timeoutMs: number }): Promise<BrowserAutomationSession>;
}

type BrowserAutomationAdapterFactory = () => BrowserAutomationAdapter;
type BrowserProcessHandle = ReturnType<typeof spawn>;

const MAX_BROWSER_OBSERVATIONS = 50;

const browserSessions = new Map<string, { session: BrowserAutomationSession; lastSnapshot: BrowserPageSnapshot; observations: readonly BrowserObservation[] }>();
let browserAutomationAdapterFactory: BrowserAutomationAdapterFactory | null = null;

export function setBrowserAutomationAdapterFactoryForTests(factory: BrowserAutomationAdapterFactory | null): void {
  browserAutomationAdapterFactory = factory;
}

export async function openBrowserSession(input: {
  readonly url: string;
  readonly headless?: boolean;
  readonly timeoutMs?: number;
}): Promise<BrowserSessionState> {
  const adapter = (browserAutomationAdapterFactory ?? createDefaultBrowserAutomationAdapter)();
  const session = await adapter.createSession({
    headless: input.headless ?? true,
    timeoutMs: input.timeoutMs ?? 20_000,
  });
  const lastSnapshot = await session.navigate(input.url);
  const id = randomUUID();
  const observations = getBrowserSessionObservations(session);
  browserSessions.set(id, { session, lastSnapshot, observations });
  return {
    id,
    lastSnapshot,
    observations,
    diagnostics: observations,
  };
}

export async function snapshotBrowserSession(input: {
  readonly sessionId: string;
  readonly maxChars?: number;
}): Promise<BrowserSessionState> {
  const record = requireBrowserSession(input.sessionId);
  const lastSnapshot = await record.session.snapshot(input.maxChars);
  const observations = getBrowserSessionObservations(record.session);
  browserSessions.set(input.sessionId, { session: record.session, lastSnapshot, observations });
  return {
    id: input.sessionId,
    lastSnapshot,
    observations,
    diagnostics: observations,
  };
}

export async function screenshotBrowserSession(input: {
  readonly sessionId: string;
}): Promise<BrowserScreenshotState> {
  const record = requireBrowserSession(input.sessionId);
  const screenshot = await record.session.screenshot();
  const observations = getBrowserSessionObservations(record.session);
  browserSessions.set(input.sessionId, { session: record.session, lastSnapshot: record.lastSnapshot, observations });
  return {
    id: input.sessionId,
    lastSnapshot: record.lastSnapshot,
    observations,
    diagnostics: observations,
    screenshot,
  };
}

export async function clickBrowserSession(input: {
  readonly sessionId: string;
  readonly selector?: string;
  readonly elementId?: string;
  readonly waitForLoad?: boolean;
}): Promise<BrowserSessionState> {
  const record = requireBrowserSession(input.sessionId);
  const lastSnapshot = await record.session.click({
    selector: input.selector,
    elementId: input.elementId,
    waitForLoad: input.waitForLoad,
  });
  const observations = getBrowserSessionObservations(record.session);
  browserSessions.set(input.sessionId, { session: record.session, lastSnapshot, observations });
  return {
    id: input.sessionId,
    lastSnapshot,
    observations,
    diagnostics: observations,
  };
}

export async function typeIntoBrowserSession(input: {
  readonly sessionId: string;
  readonly selector?: string;
  readonly elementId?: string;
  readonly text: string;
  readonly submit?: boolean;
}): Promise<BrowserSessionState> {
  const record = requireBrowserSession(input.sessionId);
  const lastSnapshot = await record.session.type({
    selector: input.selector,
    elementId: input.elementId,
    text: input.text,
    submit: input.submit,
  });
  const observations = getBrowserSessionObservations(record.session);
  browserSessions.set(input.sessionId, { session: record.session, lastSnapshot, observations });
  return {
    id: input.sessionId,
    lastSnapshot,
    observations,
    diagnostics: observations,
  };
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  const record = requireBrowserSession(sessionId);
  browserSessions.delete(sessionId);
  await record.session.close();
}

function requireBrowserSession(sessionId: string): { session: BrowserAutomationSession; lastSnapshot: BrowserPageSnapshot; observations: readonly BrowserObservation[] } {
  const record = browserSessions.get(sessionId);
  if (!record) {
    throw new Error(`Browser session ${sessionId} was not found.`);
  }
  return record;
}

function getBrowserSessionObservations(session: BrowserAutomationSession): readonly BrowserObservation[] {
  return session.diagnostics?.().slice(-MAX_BROWSER_OBSERVATIONS) ?? [];
}

function createDefaultBrowserAutomationAdapter(): BrowserAutomationAdapter {
  return new CdpBrowserAutomationAdapter();
}

class CdpBrowserAutomationAdapter implements BrowserAutomationAdapter {
  public async createSession(input: { readonly headless: boolean; readonly timeoutMs: number }): Promise<BrowserAutomationSession> {
    const executable = await resolveBrowserExecutable();
    const userDataDir = await mkdtemp(join(tmpdir(), "omni-agent-browser-"));
    const args = [
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--window-size=1440,900",
      input.headless ? "--headless=new" : "",
      "about:blank",
    ].filter(Boolean);
    const processHandle = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const browserEndpoint = await waitForBrowserEndpoint(processHandle, input.timeoutMs);
    const pageDebuggerUrl = await waitForPageDebuggerUrl(browserEndpoint, input.timeoutMs);
    return await CdpBrowserSession.create({
      browserEndpoint,
      pageDebuggerUrl,
      processHandle,
      timeoutMs: input.timeoutMs,
      userDataDir,
    });
  }
}

class CdpBrowserSession implements BrowserAutomationSession {
  private readonly socket: WebSocket;
  private readonly processHandle: BrowserProcessHandle;
  private readonly timeoutMs: number;
  private readonly userDataDir: string;
  private readonly pageDebuggerUrl: string;
  private nextMessageId = 0;
  private readonly pendingResponses = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly eventWaiters = new Map<string, Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }>>();
  private readonly observations: BrowserObservation[] = [];
  private readonly requestUrls = new Map<string, string>();
  private readonly startup: Promise<void>;

  private constructor(input: {
    readonly socket: WebSocket;
    readonly processHandle: BrowserProcessHandle;
    readonly timeoutMs: number;
    readonly userDataDir: string;
    readonly pageDebuggerUrl: string;
  }) {
    this.socket = input.socket;
    this.processHandle = input.processHandle;
    this.timeoutMs = input.timeoutMs;
    this.userDataDir = input.userDataDir;
    this.pageDebuggerUrl = input.pageDebuggerUrl;
    this.startup = this.initialize();
    this.socket.on("message", (value) => {
      const payload = JSON.parse(String(value)) as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
      if (typeof payload.id === "number") {
        const pending = this.pendingResponses.get(payload.id);
        if (!pending) {
          return;
        }
        this.pendingResponses.delete(payload.id);
        if (payload.error) {
          pending.reject(new Error(payload.error.message ?? "CDP command failed."));
          return;
        }
        pending.resolve(payload.result);
        return;
      }
      if (payload.method) {
        this.recordObservation(payload.method, payload.params);
        const waiters = this.eventWaiters.get(payload.method);
        if (!waiters || waiters.length === 0) {
          return;
        }
        const waiter = waiters.shift();
        if (waiters.length === 0) {
          this.eventWaiters.delete(payload.method);
        }
        waiter?.resolve(payload.params ?? null);
      }
    });
    this.socket.on("close", () => {
      const error = new Error("Browser session closed.");
      for (const pending of this.pendingResponses.values()) {
        pending.reject(error);
      }
      this.pendingResponses.clear();
      for (const waiters of this.eventWaiters.values()) {
        for (const waiter of waiters) {
          waiter.reject(error);
        }
      }
      this.eventWaiters.clear();
    });
  }

  public static async create(input: {
    readonly browserEndpoint: URL;
    readonly pageDebuggerUrl: string;
    readonly processHandle: BrowserProcessHandle;
    readonly timeoutMs: number;
    readonly userDataDir: string;
  }): Promise<CdpBrowserSession> {
    const socket = await connectWebSocket(input.pageDebuggerUrl, input.timeoutMs);
    return new CdpBrowserSession({
      socket,
      processHandle: input.processHandle,
      timeoutMs: input.timeoutMs,
      userDataDir: input.userDataDir,
      pageDebuggerUrl: input.pageDebuggerUrl,
    });
  }

  public async navigate(url: string): Promise<BrowserPageSnapshot> {
    await this.startup;
    await this.send("Page.navigate", { url });
    await this.waitForLoad();
    return this.snapshot();
  }

  public async snapshot(maxChars = 4_000): Promise<BrowserPageSnapshot> {
    await this.startup;
    const payload = await this.evaluate(SNAPSHOT_SCRIPT) as BrowserPageSnapshot;
    return {
      ...payload,
      text: payload.text.length > maxChars ? `${payload.text.slice(0, maxChars)}\n...[truncated]` : payload.text,
    };
  }

  public async screenshot(): Promise<BrowserScreenshotCapture> {
    await this.startup;
    const payload = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    }) as { data?: unknown };
    if (typeof payload.data !== "string" || payload.data.length === 0) {
      throw new Error("Browser screenshot capture did not return image data.");
    }
    return {
      dataBase64: payload.data,
      mimeType: "image/png",
      capturedAt: new Date().toISOString(),
    };
  }

  public async click(input: {
    readonly selector?: string;
    readonly elementId?: string;
    readonly waitForLoad?: boolean;
  }): Promise<BrowserPageSnapshot> {
    await this.startup;
    const selector = resolveBrowserTargetSelector(input.selector, input.elementId);
    const clicked = await this.evaluate(
      `(${CLICK_SCRIPT})(${JSON.stringify({ selector })})`,
    );
    if (!clicked) {
      throw new Error(`Could not click browser target ${selector}.`);
    }
    if (input.waitForLoad !== false) {
      await this.waitForLoad(1_000).catch(() => undefined);
    }
    return this.snapshot();
  }

  public async type(input: {
    readonly selector?: string;
    readonly elementId?: string;
    readonly text: string;
    readonly submit?: boolean;
  }): Promise<BrowserPageSnapshot> {
    await this.startup;
    const selector = resolveBrowserTargetSelector(input.selector, input.elementId);
    const typed = await this.evaluate(
      `(${TYPE_SCRIPT})(${JSON.stringify({ selector, text: input.text, submit: Boolean(input.submit) })})`,
    );
    if (!typed) {
      throw new Error(`Could not type into browser target ${selector}.`);
    }
    if (input.submit) {
      await this.waitForLoad(1_000).catch(() => undefined);
    }
    return this.snapshot();
  }

  public diagnostics(): readonly BrowserObservation[] {
    return [...this.observations];
  }

  public async close(): Promise<void> {
    try {
      this.socket.close();
    } finally {
      this.processHandle.kill();
      await rm(this.userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async initialize(): Promise<void> {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
  }

  private async waitForLoad(timeoutMs = this.timeoutMs): Promise<void> {
    await this.waitForEvent("Page.loadEventFired", timeoutMs);
  }

  private async evaluate(expression: string): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: unknown } };
    return result.result?.value;
  }

  private async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextMessageId;
    return await new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Browser command ${method} timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      this.pendingResponses.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutHandle);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private async waitForEvent(method: string, timeoutMs: number): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Browser event ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const queue = this.eventWaiters.get(method) ?? [];
      queue.push({
        resolve: (value) => {
          clearTimeout(timeoutHandle);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
      });
      this.eventWaiters.set(method, queue);
    });
  }

  private recordObservation(method: string, params: unknown): void {
    this.rememberNetworkRequest(method, params);
    const observation = this.normalizeObservation(method, params);
    if (!observation) {
      return;
    }
    this.observations.push(observation);
    if (this.observations.length > MAX_BROWSER_OBSERVATIONS) {
      this.observations.splice(0, this.observations.length - MAX_BROWSER_OBSERVATIONS);
    }
  }

  private normalizeObservation(method: string, params: unknown): BrowserObservation | null {
    if (!params || typeof params !== "object") {
      return null;
    }
    const record = params as Record<string, unknown>;
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(record.args) ? record.args : [];
      const message = args
        .map((arg) => formatConsoleArgument(arg))
        .filter(Boolean)
        .join(" ");
      return {
        kind: "console",
        timestamp: new Date().toISOString(),
        level: typeof record.type === "string" ? record.type : "log",
        message: message || "Console message emitted.",
      };
    }
    if (method === "Network.loadingFailed") {
      const requestId = typeof record.requestId === "string" ? record.requestId : "";
      return {
        kind: "request-failure",
        timestamp: new Date().toISOString(),
        message: typeof record.errorText === "string" ? record.errorText : "Network request failed.",
        errorText: typeof record.errorText === "string" ? record.errorText : undefined,
        url: this.requestUrls.get(requestId),
      };
    }
    return null;
  }

  private rememberNetworkRequest(method: string, params: unknown): void {
    if (method !== "Network.requestWillBeSent" || !params || typeof params !== "object") {
      return;
    }
    const record = params as { requestId?: unknown; request?: { url?: unknown; method?: unknown } };
    if (typeof record.requestId !== "string" || typeof record.request?.url !== "string") {
      return;
    }
    this.requestUrls.set(record.requestId, record.request.url);
    if (this.requestUrls.size > MAX_BROWSER_OBSERVATIONS * 2) {
      const staleIds = [...this.requestUrls.keys()].slice(0, this.requestUrls.size - MAX_BROWSER_OBSERVATIONS);
      for (const staleId of staleIds) {
        this.requestUrls.delete(staleId);
      }
    }
  }
}

function formatConsoleArgument(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.value === "string") {
    return record.value;
  }
  if (record.value !== undefined) {
    return String(record.value);
  }
  if (typeof record.description === "string") {
    return record.description;
  }
  return "";
}

async function connectWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeoutHandle = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out connecting to browser debugger at ${url}.`));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timeoutHandle);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function waitForBrowserEndpoint(processHandle: BrowserProcessHandle, timeoutMs: number): Promise<URL> {
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const stderr = processHandle.stderr;
    const stdout = processHandle.stdout;
    if (!stderr && !stdout) {
      reject(new Error("Browser process did not expose stdout or stderr for debugger discovery."));
      return;
    }
    const timeoutHandle = setTimeout(() => {
      reject(new Error("Timed out waiting for the browser debugging endpoint."));
    }, timeoutMs);
    const matchEndpoint = (chunk: Buffer | string): void => {
      const text = String(chunk);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match?.[1]) {
        return;
      }
      clearTimeout(timeoutHandle);
      resolve(match[1]);
    };
    stderr?.on("data", matchEndpoint);
    stdout?.on("data", matchEndpoint);
    processHandle.once("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    processHandle.once("exit", (code) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Browser process exited before debugger startup (code ${code ?? -1}).`));
    });
  });
  return new URL(wsUrl);
}

async function waitForPageDebuggerUrl(browserEndpoint: URL, timeoutMs: number): Promise<string> {
  const jsonUrl = new URL("/json/list", `${browserEndpoint.protocol === "wss:" ? "https:" : "http:"}//${browserEndpoint.host}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(jsonUrl);
    if (response.ok) {
      const payload = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const page = payload.find((entry) => entry.type === "page" && typeof entry.webSocketDebuggerUrl === "string");
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for a debuggable browser page.");
}

async function resolveBrowserExecutable(): Promise<string> {
  const configured = process.env.OMNI_AGENT_BROWSER_EXECUTABLE?.trim();
  if (configured) {
    return configured;
  }
  const platform = process.platform;
  const candidates =
    platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/usr/bin/microsoft-edge",
          ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No Chromium-based browser executable was found. Set OMNI_AGENT_BROWSER_EXECUTABLE to Chrome or Edge.");
}

function resolveBrowserTargetSelector(selector: string | undefined, elementId: string | undefined): string {
  if (typeof selector === "string" && selector.trim().length > 0) {
    return selector.trim();
  }
  if (typeof elementId === "string" && elementId.trim().length > 0) {
    return `[data-omni-agent-id="${elementId.trim()}"]`;
  }
  throw new Error("Browser actions require either selector or elementId.");
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

const SNAPSHOT_SCRIPT = `(() => {
  const limitText = (value, max = 240) => String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, max);
  const buildSelector = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-test") || element.getAttribute("name");
    if (testId) return element.tagName.toLowerCase() + "[name=\\"" + String(testId).replace(/"/g, "\\\\\\"") + "\\"]";
    return element.tagName.toLowerCase();
  };
  const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[onclick]'))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, 25)
    .map((element, index) => {
      const elementId = element.getAttribute("data-omni-agent-id") || "oa-" + index;
      element.setAttribute("data-omni-agent-id", elementId);
      return {
        elementId,
        tag: element.tagName.toLowerCase(),
        text: limitText(element.innerText || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.value || ""),
        selector: buildSelector(element),
        type: element.getAttribute("type") || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        value: "value" in element ? limitText(element.value || "", 120) : undefined,
      };
    });
  return {
    title: document.title || "",
    url: location.href,
    text: (document.body?.innerText || "").trim(),
    elements,
    loadedAt: new Date().toISOString(),
  };
})()`;

const CLICK_SCRIPT = `(input => {
  const element = document.querySelector(input.selector);
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  element.click();
  return true;
})`;

const TYPE_SCRIPT = `(input => {
  const element = document.querySelector(input.selector);
  if (!(element instanceof HTMLElement) || !("value" in element)) {
    return false;
  }
  element.focus();
  element.value = input.text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (input.submit) {
    const form = element.closest("form");
    if (form) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
    } else {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    }
  }
  return true;
})`;
