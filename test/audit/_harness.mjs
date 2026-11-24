// 插件功能回归脚本的公共 CDP harness。
// 统一：连接、求值、等待、可靠重载、状态快照/恢复、截图+sidecar、源码/装机副本哈希前置。
// 各 verify-*.mjs 只写业务判定，不再各自实现 CDP 客户端。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseExpectContent, contentProbeExpression, contentFailureMessage } from '../evidence-proof.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHOTS = path.join(ROOT, 'shots');
export const PORT = process.env.CDP_PORT ?? '9224';
const APP_CONTEXT_URL = '/scripts/extensions/third-party/Veridis-Rewrite/src/host/appContext.js';
const AI_SETTING_FIELDS = ['enabled', 'baseUrl', 'apiKey', 'model', 'modelOptions', 'manualModels'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connect({ port = PORT, urlPart = '127.0.0.1:8000', front = true } = {}) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.url.includes(urlPart))
        || list.find((t) => t.type === 'page');
    if (!page) throw new Error('没有可用的调试页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__stProbeErrors = [];
            addEventListener('error', e => window.__stProbeErrors.push(String(e.message)));
            addEventListener('unhandledrejection', e => window.__stProbeErrors.push(String(e.reason)));`,
    });
    if (front) await send('Page.bringToFront');
    return { ws, send, page };
}

export async function evaluate(send, expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
}

export async function waitFor(send, expression, label, tries = 50, interval = 200) {
    for (let i = 0; i < tries; i++) {
        if (await evaluate(send, expression)) return;
        await sleep(interval);
    }
    throw new Error(`等待超时：${label}`);
}

// reload 返回后短时间内仍可能读到旧文档；用旧文档标记等真重载完成。
export async function reloadAndWait(send, expression, label, tries = 120) {
    await evaluate(send, `(() => { window.__harnessReloadToken = true; return true; })()`);
    await send('Page.reload', { ignoreCache: true });
    await waitFor(send, `!window.__harnessReloadToken && document.readyState === 'complete' && (${expression})`, label, tries, 300);
}

export function check(failures, name, ok, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
    if (!ok) failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

// 真实设置对象快照：审计不能只看表单，否则 UI 与 extension_settings 不同步时会把污染当基线。
export async function snapshotAiSettings(send) {
    return evaluate(send, `(async () => {
        const app = await import('${APP_CONTEXT_URL}');
        const ai = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite?.aiRewrite;
        if (!ai) return null;
        const fields = ${JSON.stringify(AI_SETTING_FIELDS)};
        const out = {};
        for (const key of fields) out[key] = JSON.parse(JSON.stringify(ai[key] ?? null));
        return out;
    })()`);
}

// 把 AI 设置压到确定性基线，避免上一个脚本留下的 mock API / 手动模型影响本脚本。
export async function normalizeAiSettings(send) {
    return evaluate(send, `(async () => {
        const app = await import('${APP_CONTEXT_URL}');
        const ctx = app.getAppContext();
        const ai = ctx.extension_settings?.ultimate_purifier_ai_rewrite?.aiRewrite;
        if (!ai) return false;
        ai.enabled = false;
        ai.baseUrl = '';
        ai.apiKey = '';
        ai.model = '';
        ai.modelOptions = [];
        ai.manualModels = [];
        // 审计会立即重载，debounce 来不及落盘；直接 await 保存接口。
        const st = await import('/script.js');
        await st.saveSettings();
        return true;
    })()`);
}

export async function restoreAiSettings(send, snapshot) {
    if (!snapshot) return false;
    return evaluate(send, `(async () => {
        const app = await import('${APP_CONTEXT_URL}');
        const ctx = app.getAppContext();
        const ai = ctx.extension_settings?.ultimate_purifier_ai_rewrite?.aiRewrite;
        if (!ai) return false;
        const snapshot = ${JSON.stringify(snapshot)};
        for (const [key, value] of Object.entries(snapshot)) ai[key] = value;
        const st = await import('/script.js');
        await st.saveSettings();
        return true;
    })()`);
}

// 取值/勾选/禁用状态快照；restore 会只改变化项并派发 input/change。
export async function snapshotState(send, selectors = []) {
    return evaluate(send, `(() => {
        const spec = ${JSON.stringify(selectors)};
        const out = {};
        for (const sel of spec) {
            const el = document.querySelector(sel);
            out[sel] = el ? { value: el.value ?? null, checked: el.checked ?? null, disabled: el.disabled ?? null } : null;
        }
        return out;
    })()`);
}

export async function restoreState(send, snapshot = {}) {
    return evaluate(send, `(() => {
        const snapshot = ${JSON.stringify(snapshot)};
        for (const [sel, state] of Object.entries(snapshot)) {
            const el = document.querySelector(sel);
            if (!el || !state) continue;
            if (state.value !== null && el.value !== state.value && typeof state.value === 'string') {
                el.value = state.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (typeof state.checked === 'boolean' && el.checked !== state.checked) el.click();
        }
        return true;
    })()`);
}

export async function capture(send, name, { expectOpen = [], expectContent = null, state = {} } = {}) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const contentSpec = expectContent
        ? parseExpectContent(typeof expectContent === 'string'
            ? expectContent
            : `${expectContent.selector}:${expectContent.min ?? 1}`)
        : null;
    const probe = await evaluate(send, `({
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, url: location.href },
        errors: (window.__stProbeErrors || []).slice(),
        targets: ${JSON.stringify(expectOpen)}.map((sel) => {
            const el = document.querySelector(sel);
            if (!el) return { sel, ok: false, reason: 'not found' };
            const st = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            const visible = st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
            if (!visible || b.width <= 1 || b.height <= 1) {
                return { sel, ok: false, reason: 'not visible', display: st.display, w: b.width, h: b.height };
            }
            return { sel, ok: true, w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
        }),
    })`);
    const bad = probe.targets.filter((t) => !t.ok);
    if (bad.length) throw new Error(`截图证据无效，目标不可见：${bad.map((t) => `${t.sel}(${t.reason})`).join(', ')}`);
    const content = contentSpec ? await evaluate(send, contentProbeExpression(contentSpec)) : null;
    const contentError = contentFailureMessage(contentSpec, content);
    if (contentError) throw new Error(`截图证据无效：${contentError}`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const target = path.join(SHOTS, name);
    fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(`${target}.json`, JSON.stringify({
        out: name, checkedAt: new Date().toISOString(), viewport: probe.viewport,
        expectOpen: expectOpen.length ? expectOpen : null, targets: probe.targets,
        expectContent: contentSpec, content,
        consoleErrors: probe.errors, state,
    }, null, 2));
    return path.relative(ROOT, target).replace(/\\/g, '/');
}

// 与 sync.mjs 相同的受管文件口径；避免“验证的是旧装机副本”。
export function assertManagedFilesSynced({
    src = ROOT,
    dst = process.env.BLAI_DST ?? 'D:/Games/SillyTavern/SillyTavern/data/default-user/extensions/Veridis-Rewrite',
} = {}) {
    const exts = new Set(['.js', '.css', '.json', '.md', '.html']);
    const skipDirs = new Set(['.git', 'node_modules', 'dev', 'test', 'tmp', '_tmp', '_archive', 'shots', 'css-backup']);
    const skipName = /^(?:build-.*\.mjs|package(?:-lock)?\.json|AGENTS\.md|MODULES\.md|CHANGELOG\.md|todo\.md)$/i;
    const skipFile = /\.(png|jpe?g|gif|webp|zip|bak|orig|tmp|log)$/i;
    const files = [];
    const walk = (rel) => {
        for (const entry of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
            if (skipDirs.has(entry.name)) continue;
            const child = path.join(rel, entry.name);
            if (entry.isDirectory()) { walk(child); continue; }
            if (skipFile.test(entry.name) || skipName.test(entry.name) || !exts.has(path.extname(entry.name))) continue;
            files.push(child.replace(/\\/g, '/'));
        }
    };
    walk('');
    const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const diff = [];
    const missing = [];
    for (const rel of files) {
        const target = path.join(dst, rel);
        if (!fs.existsSync(target)) { missing.push(rel); continue; }
        if (hash(path.join(src, rel)) !== hash(target)) diff.push(rel);
    }
    if (diff.length || missing.length) {
        throw new Error(`源码与装机副本不同步：不一致 ${diff.length}，缺失 ${missing.length}；先跑 sync.mjs`);
    }
    return files.length;
}
