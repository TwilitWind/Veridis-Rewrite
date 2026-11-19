// Minimal CDP screenshot driver for a local SillyTavern instance.
// Usage: node st-shot.mjs <outfile.png> [jsToEval] [waitMs]
//   CLIP=<css selector> SCALE=3   -> screenshot only that element, enlarged
//   FRONT=1                       -> Page.bringToFront first (needed before sampling animations)
import fs from 'node:fs';

const out = process.argv[2] ?? 'shot.png';
let evalJs = process.argv[3] ?? '';
// Allow evalJS to come from a file to dodge shell quoting issues.
if (evalJs.startsWith('@')) evalJs = fs.readFileSync(evalJs.slice(1), 'utf8');
const waitMs = Number(process.argv[4] ?? 1200);
const PORT = process.env.CDP_PORT ?? '9222';

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
        console.error('CLIP =>', JSON.stringify(clip));
    }

    const shot = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: process.env.FROM_SURFACE !== '0',
        ...(clip ? { clip } : {}),
    });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('saved', out);
    ws.close();
}

main().catch((e) => {
    console.error('FAILED', e);
    process.exit(1);
});