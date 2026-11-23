// True mobile emulation for SillyTavern (CDP): viewport + DPR + touch + phone UA.
// Usage: node st-mobile.mjs <outfile.png> [jsToEval|@file] [waitMs]
//   DEVICE=iphone14|pixel7|ipad|WxH   (default iphone14)
//   CDP_PORT=9224  NO_NAV=1 (reuse current page)  RELOAD=1 (reload in place)
//   LOAD_MS=7000   DPR=3 (override)  MOBILE=0 (keep desktop UA, viewport only)
//   RESET=1 -> clear emulation, restore desktop UA, no screenshot
//   FRAME=1 -> draw an Android/Chrome shell around the shot (status bar,
//              address bar, gesture bar). FRAME_THEME=light|dark forces it;
//              default follows the page's active theme. FRAME_URL sets the
//              address text (default 127.0.0.1:8000).
import fs from 'node:fs';
import { framePng } from './mobile-frame.mjs';

const DEVICES = {
    iphone14: {
        width: 390, height: 844, dpr: 3,
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        uaMetadata: { platform: 'iPhone', platformVersion: '17.0', architecture: '', model: 'iPhone', mobile: true,
            brands: [{ brand: 'Safari', version: '17.0' }], fullVersion: '17.0' },
    },
    pixel7: {
        width: 412, height: 915, dpr: 2.625,
        ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        uaMetadata: { platform: 'Android', platformVersion: '14.0.0', architecture: '', model: 'Pixel 7', mobile: true,
            brands: [{ brand: 'Chromium', version: '126' }, { brand: 'Google Chrome', version: '126' }], fullVersion: '126.0.6478.122' },
    },
    xiaomi14: {
        width: 400, height: 890, dpr: 3,
        ua: 'Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        uaMetadata: { platform: 'Android', platformVersion: '14.0.0', architecture: '', model: '23127PN0CC', mobile: true,
            brands: [{ brand: 'Chromium', version: '126' }, { brand: 'Google Chrome', version: '126' }], fullVersion: '126.0.6478.122' },
    },
    redmi: {
        width: 393, height: 873, dpr: 2.75,
        ua: 'Mozilla/5.0 (Linux; Android 13; 23021RAAEG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        uaMetadata: { platform: 'Android', platformVersion: '13.0.0', architecture: '', model: '23021RAAEG', mobile: true,
            brands: [{ brand: 'Chromium', version: '126' }, { brand: 'Google Chrome', version: '126' }], fullVersion: '126.0.6478.122' },
    },
    ipad: {
        width: 820, height: 1180, dpr: 2,
        ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        uaMetadata: { platform: 'iPad', platformVersion: '17.0', architecture: '', model: 'iPad', mobile: true,
            brands: [{ brand: 'Safari', version: '17.0' }], fullVersion: '17.0' },
    },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2] ?? 'mobile.png';
let evalJs = process.argv[3] ?? '';
if (evalJs.startsWith('@')) evalJs = fs.readFileSync(evalJs.slice(1), 'utf8');
const waitMs = Number(process.argv[4] ?? 1500);
const PORT = process.env.CDP_PORT ?? '9224';

const devArg = process.env.DEVICE ?? 'iphone14';
let dev;
const presets = DEVICES[devArg];
if (presets) dev = { ...presets };
else {
    const m = /^(\d+)x(\d+)$/.exec(devArg);
    if (!m) throw new Error('bad DEVICE: ' + devArg);
    dev = { ...DEVICES.iphone14, width: Number(m[1]), height: Number(m[2]) };
}
if (process.env.DPR) dev.dpr = Number(process.env.DPR);
const wantPhone = process.env.MOBILE !== '0';

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
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

const probeExpr = '(' + (async () => {
    const ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
    return {
        isMobile: ctx ? (typeof ctx.isMobile === 'function' ? ctx.isMobile() : ctx.isMobile) : 'NO_CONTEXT',
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
        touch: 'ontouchstart' in window && navigator.maxTouchPoints,
        coarse: matchMedia('(pointer: coarse)').matches,
        ua: navigator.userAgent.slice(0, 70),
        errors: (window.__stProbeErrors || []).slice(0, 5),
    };
}).toString() + ')()';

async function probe() {
    const r = await send('Runtime.evaluate', { expression: probeExpr, awaitPromise: true, returnByValue: true });
    return r.result?.value;
}

if (process.env.RESET === '1') {
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Network.setUserAgentOverride', { userAgent: '' });
    await send('Page.reload', { ignoreCache: false });
    await sleep(Number(process.env.LOAD_MS ?? 6000));
    console.log(JSON.stringify({ reset: true, probe: await probe() }));
    ws.close();
    process.exit(0);
}

// 1) viewport — mobile:true is what makes <meta viewport width=device-width> take effect,
//    so innerWidth becomes 390 instead of a squeezed 1353.
await send('Emulation.setDeviceMetricsOverride', {
    width: dev.width,
    height: dev.height,
    deviceScaleFactor: dev.dpr,
    mobile: true,
    screenOrientation: { type: dev.width > dev.height ? 'landscapePrimary' : 'portraitPrimary', angle: 0 },
});
// 2) touch — hover-only and tap handlers differ on phones.
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// 3) UA — SillyTavern's isMobile() is Bowser.parse(navigator.userAgent).platform.type,
//    so the UA string is the switch. Must be applied before the reload below.
if (wantPhone) {
    await send('Network.setUserAgentOverride', {
        userAgent: dev.ua,
        acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
        platform: dev.platform,
        userAgentMetadata: dev.uaMetadata,
    });
}
await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__stProbeErrors = [];addEventListener("error",e=>window.__stProbeErrors.push(String(e.message)));addEventListener("unhandledrejection",e=>window.__stProbeErrors.push(String(e.reason)));',
});

const target = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
// NO_NAV=1 means "reuse the current live page" — no navigation AND no reload,
// so an already-open extension drawer/panel survives the screenshot.
if (process.env.NO_NAV === '1') {
    // reuse as-is; UA must already be set by an earlier run in this page session
} else if (process.env.RELOAD === '1') {
    await send('Page.reload', { ignoreCache: false });
} else {
    await send('Page.navigate', { url: target });
}
await sleep(Number(process.env.LOAD_MS ?? 7000));

const p = await probe();
console.error('PROBE =>', JSON.stringify(p));

if (evalJs) {
    const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.error('EVAL ERROR', JSON.stringify(r.exceptionDetails));
    else if (r.result?.value !== undefined) {
        const v = r.result.value;
        console.error('EVAL =>', typeof v === 'string' ? v : JSON.stringify(v));
    }
    await sleep(waitMs);
}

const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
let png = Buffer.from(shot.data, 'base64');
let framed = false;
if (process.env.FRAME === '1') {
    // follow the page theme unless explicitly set, so the bar does not clash
    let theme = process.env.FRAME_THEME;
    if (theme !== 'light' && theme !== 'dark') {
        const t = await send('Runtime.evaluate', {
            expression: '(document.body.classList.contains("dark") || getComputedStyle(document.body).backgroundColor.match(/\\d+/g)?.slice(0,3).map(Number).reduce((a,b)=>a+b,0) < 240) ? "dark" : "light"',
            returnByValue: true,
        });
        theme = t.result?.value === 'dark' ? 'dark' : 'light';
    }
    const urlText = process.env.FRAME_URL || '127.0.0.1:8000';
    try {
        png = await framePng(png, { port: PORT, device: dev, theme, url: urlText });
        framed = true;
    } catch (e) {
        console.error('FRAME failed, writing raw shot:', e.message);
    }
}
fs.writeFileSync(out, png);
console.log(JSON.stringify({ saved: out, device: devArg, framed, probe: p }));
ws.close();