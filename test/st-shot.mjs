// Minimal CDP screenshot driver for a local SillyTavern instance.
// Usage: node st-shot.mjs <outfile.png> [jsToEval] [waitMs]
//   CLIP=<css selector> SCALE=3   -> screenshot only that element, enlarged
//   FRONT=1                       -> Page.bringToFront first (needed before sampling animations)
//   EXPECT_OPEN=<sel[,sel...]>    -> 截图前确认目标可见且非 0 尺寸，否则拒绝出图（防「截到空页还当证据」）
//   EXPECT_CONTENT='<rowSelector>[:<min>]' -> 截图前确认内容区真的有数据行（默认至少 1 行），否则拒绝出图
//   SEED_JS=<js|@file.js>         -> 出图前跑一次性种子脚本（酒馆数据为空时造样例），执行失败即拒绝出图
//   EXPECT_MAXIMIZED=1            -> 截图前确认浏览器窗口 maximized/fullscreen，否则拒绝出图
//   每次出图写 <outfile>.json sidecar：视口、窗口状态、目标可见性、内容行数、控制台错误——让证据可追溯。
import fs from 'node:fs';
import { parseExpectContent, contentProbeExpression, contentFailureMessage } from './evidence-proof.mjs';

const out = process.argv[2] ?? 'shot.png';
let evalJs = process.argv[3] ?? '';
// Allow evalJS to come from a file to dodge shell quoting issues.
if (evalJs.startsWith('@')) evalJs = fs.readFileSync(evalJs.slice(1), 'utf8');
const waitMs = Number(process.argv[4] ?? 1200);
const PORT = process.env.CDP_PORT ?? '9224';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
    });

    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const mid = ++id;
            pending.set(mid, { resolve, reject });
            ws.send(JSON.stringify({ id: mid, method, params }));
        });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__stProbeErrors = [];
            addEventListener('error', e => window.__stProbeErrors.push(String(e.message)));
            addEventListener('unhandledrejection', e => window.__stProbeErrors.push(String(e.reason)));`,
    });
    // 后台标签页会节流动画与定时器（~1s 钳制），量动画前必须先置前。
    if (process.env.FRONT === '1') await send('Page.bringToFront');
    if (process.env.VIEWPORT) {
        const [width, height] = process.env.VIEWPORT.split('x').map(Number);
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    }
    const target = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
    if (process.env.NO_NAV !== '1') {
        await send('Page.navigate', { url: target });
        await sleep(Number(process.env.LOAD_MS ?? 6000));
    }

    // ---- 证据定义与种子：必须在打开界面前跑，否则空数据态会被当证据 ----
    const contentSpec = parseExpectContent(process.env.EXPECT_CONTENT);
    const seedJs = process.env.SEED_JS
        ? (process.env.SEED_JS.startsWith('@') ? fs.readFileSync(process.env.SEED_JS.slice(1), 'utf8') : process.env.SEED_JS)
        : '';
    const evidence = {
        out, checkedAt: new Date().toISOString(),
        evalJs: evalJs || null, seedJs: seedJs || null, waitMs,
        expectOpen: process.env.EXPECT_OPEN ?? null,
        expectContent: contentSpec,
        content: null,
        expectMaximized: process.env.EXPECT_MAXIMIZED === '1',
        viewport: null, windowState: null, openTargets: [], consoleErrors: [],
    };
    const failEvidence = (msg) => {
        console.error('EVIDENCE FAIL:', msg);
        ws.close();
        process.exit(3);
    };

    if (seedJs) {
        const r = await send('Runtime.evaluate', { expression: seedJs, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
            failEvidence(`SEED_JS 执行失败：${r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)}`);
        }
        console.error('SEED =>', r.result?.value);
    }

    if (evalJs) {
        const r = await send('Runtime.evaluate', {
            expression: evalJs,
            awaitPromise: true,
            returnByValue: true,
        });
        if (r.exceptionDetails) console.error('EVAL ERROR', JSON.stringify(r.exceptionDetails));
        else if (r.result?.value !== undefined) console.error('EVAL =>', r.result.value);
        await sleep(waitMs);
    }

    // 视口与控制台错误：这两项无论是否设期望都记录，供事后追溯。
    const vp = await send('Runtime.evaluate', {
        expression: `({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, url: location.href,
            errors: (window.__stProbeErrors || []).slice() })`,
        returnByValue: true,
    });
    evidence.viewport = vp.result?.value ?? null;
    evidence.consoleErrors = evidence.viewport?.errors ?? [];

    if (evidence.expectMaximized) {
        try {
            const wf = await send('Browser.getWindowForTarget', { targetId: page.id });
            const wb = await send('Browser.getWindowBounds', { windowId: wf.windowId });
            evidence.windowState = wb.bounds?.windowState ?? null;
        } catch (e) {
            console.error('EXPECT_MAXIMIZED 查询失败：', String(e));
            evidence.windowState = 'unknown';
        }
        if (!['maximized', 'fullscreen'].includes(evidence.windowState)) {
            failEvidence(`窗口未最大化（当前 ${evidence.windowState}）；请先用 st-window.mjs 或 --start-maximized 再截图`);
        }
    }

    if (evidence.expectOpen) {
        const selectors = evidence.expectOpen.split(',').map((s) => s.trim()).filter(Boolean);
        const probe = await send('Runtime.evaluate', {
            expression: `(${JSON.stringify(selectors)}).map(s => {
                const el = document.querySelector(s);
                if (!el) return { sel: s, ok: false, reason: 'not found' };
                const st = getComputedStyle(el), b = el.getBoundingClientRect();
                const visible = st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
                if (!visible) return { sel: s, ok: false, reason: 'hidden', display: st.display, visibility: st.visibility, opacity: st.opacity };
                if (b.width <= 1 || b.height <= 1) return { sel: s, ok: false, reason: 'zero-size', w: b.width, h: b.height };
                return { sel: s, ok: true, w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
            })`,
            returnByValue: true,
        });
        evidence.openTargets = probe.result?.value ?? [];
        const bad = evidence.openTargets.filter((t) => !t.ok);
        if (bad.length) {
            failEvidence(`目标不可见：${bad.map((t) => `${t.sel}(${t.reason})`).join(', ')}；先打开目标弹窗/页面再截图`);
        }
    }

    if (contentSpec) {
        const r = await send('Runtime.evaluate', {
            expression: contentProbeExpression(contentSpec),
            returnByValue: true,
        });
        evidence.content = r.result?.value ?? null;
        const message = contentFailureMessage(contentSpec, evidence.content);
        if (message) failEvidence(message);
        console.error('CONTENT =>', JSON.stringify(evidence.content));
    }

    // CLIP=<selector> 只截该元素，SCALE 放大倍数（默认 3），用于看清小控件。
    const clipSel = process.env.CLIP;
    let clip;
    if (clipSel) {
        const r = await send('Runtime.evaluate', {
            expression: `(() => { const el = document.querySelector(${JSON.stringify(clipSel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`,
            returnByValue: true,
        });
        const b = r.result?.value;
        if (!b || !b.w || !b.h) {
            console.error('CLIP selector not found or zero-size:', clipSel);
            process.exit(2);
        }
        clip = {
            x: b.x, y: b.y, width: b.w, height: b.h,
            scale: Number(process.env.SCALE ?? 3),
        };
        evidence.clip = clip;
        console.error('CLIP =>', JSON.stringify(clip));
    }

    const shot = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: process.env.FROM_SURFACE !== '0',
        ...(clip ? { clip } : {}),
    });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(`${out}.json`, JSON.stringify(evidence, null, 2));
    console.log('saved', out, `(+ ${out}.json)`);
    ws.close();
}

main().catch((e) => {
    console.error('FAILED', e);
    process.exit(1);
});