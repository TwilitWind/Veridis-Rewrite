// Compose a mobile screenshot into an Android/Chrome style frame:
// status bar + address bar + gesture bar. Used by st-mobile.mjs (FRAME=1).
// No external deps: a scratch CDP target renders the frame HTML and is screenshotted.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clock() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

const svgSignal = '<svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.7" y="5.5" width="3" height="6.5" rx="1"/><rect x="9.4" y="3" width="3" height="9" rx="1"/><rect x="14.1" y="0.5" width="3" height="11.5" rx="1"/></svg>';
const svgWifi = '<svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.4 5.4 8.5a3.8 3.8 0 0 1 5.2 0L8 11.4Z"/><path d="M8 5.1c1.7 0 3.2.66 4.35 1.73l1.4-1.55A8.6 8.6 0 0 0 8 3.1a8.6 8.6 0 0 0-5.75 2.18l1.4 1.55A6.6 6.6 0 0 1 8 5.1Z"/><path d="M8 .6c2.9 0 5.55 1.1 7.55 2.9L14.15 5A9.6 9.6 0 0 0 8 2.6 9.6 9.6 0 0 0 1.85 5L.45 3.5A11.4 11.4 0 0 1 8 .6Z"/></svg>';
const svgBattery = '<svg width="26" height="12" viewBox="0 0 26 12" fill="currentColor"><rect x=".6" y=".6" width="22" height="10.8" rx="3.2" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><rect x="2.4" y="2.4" width="15" height="7.2" rx="1.8"/><rect x="23.8" y="4" width="1.8" height="4" rx=".9" fill-opacity=".45"/></svg>';
const svgLock = '<svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><path d="M6 0a4 4 0 0 0-4 4v1H1.4A1.4 1.4 0 0 0 0 6.4v6.2A1.4 1.4 0 0 0 1.4 14h9.2A1.4 1.4 0 0 0 12 12.6V6.4A1.4 1.4 0 0 0 10.6 5H10V4a4 4 0 0 0-4-4Zm0 1.8A2.2 2.2 0 0 1 8.2 4v1H3.8V4A2.2 2.2 0 0 1 6 1.8Z"/></svg>';
const svgTabs = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="3.2" width="9.6" height="9.6" rx="2"/><path d="M4.4 3.2V2.1A1.6 1.6 0 0 1 6 0.5h6.3A1.6 1.6 0 0 1 13.9 2.1V8.4a1.6 1.6 0 0 1-1.6 1.6h-1.2"/></svg>';
const svgMore = '<svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor"><circle cx="2" cy="2" r="1.7"/><circle cx="2" cy="8" r="1.7"/><circle cx="2" cy="14" r="1.7"/></svg>';

function buildHtml(o) {
    const dark = o.dark;
    const bg = dark ? '#1f2023' : '#ffffff';
    const fg = dark ? '#e8eaed' : '#111318';
    const subtle = dark ? '#303134' : '#f1f3f4';
    const line = dark ? '#35363a' : '#e6e6e6';
    const urlFg = dark ? '#e8eaed' : '#202124';
    return [
        '<!doctype html><meta charset="utf-8">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'html,body{width:' + o.cssW + 'px;height:' + o.cssH + 'px;overflow:hidden;background:' + bg + ';}',
        'body{font-family:Roboto,"Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}',
        '.screen{display:flex;flex-direction:column;width:' + o.cssW + 'px;height:' + o.cssH + 'px}',
        '.status{flex:0 0 ' + o.statusH + 'px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;color:' + fg + ';font-size:14px;font-weight:500;letter-spacing:.2px}',
        '.status .right{display:flex;align-items:center;gap:7px;opacity:.92}',
        '.url{flex:0 0 ' + o.urlH + 'px;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid ' + line + '}',
        '.addr{flex:1 1 auto;height:38px;border-radius:999px;background:' + subtle + ';display:flex;align-items:center;gap:9px;padding:0 16px}',
        '.addr span{font-size:15px;color:' + urlFg + ';opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.addr .lock{color:' + urlFg + ';opacity:.6;display:flex}',
        '.tabbox{position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:' + fg + ';border:2px solid ' + fg + ';border-radius:7px;opacity:.85}',
        '.tabbox b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 14px/1 Roboto,system-ui}',
        '.more{width:22px;display:flex;align-items:center;justify-content:center;color:' + fg + ';opacity:.8}',
        '.content{flex:0 0 ' + o.dev.height + 'px;width:' + o.cssW + 'px;overflow:hidden;background:' + bg + '}',
        '.content img{display:block;width:' + o.cssW + 'px;height:' + o.dev.height + 'px}',
        '.nav{flex:0 0 ' + o.navH + 'px;display:flex;align-items:center;justify-content:center}',
        '.pill{width:34%;height:5px;border-radius:999px;background:' + fg + ';opacity:.7}',
        '</style>',
        '<div class="screen">',
        '<div class="status"><div>' + o.time + '</div><div class="right">' + svgSignal + svgWifi + svgBattery + '</div></div>',
        '<div class="url"><div class="addr"><i class="lock">' + svgLock + '</i><span>' + o.urlText + '</span></div><div class="tabbox"><b>1</b></div><div class="more">' + svgMore + '</div></div>',
        '<div class="content"><img src="' + o.img + '"></div>',
        '<div class="nav"><div class="pill"></div></div>',
        '</div>',
    ].join('');
}

async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
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
    return { ws, send };
}

// opt: { port, device:{width,height,dpr}, theme:'light'|'dark', url }
export async function framePng(png, opt) {
    const port = opt.port || '9222';
    const dev = opt.device;
    const statusH = 30;
    const urlH = 54;
    const navH = 26;
    const cssW = dev.width;
    const cssH = dev.height + statusH + urlH + navH;
    const html = buildHtml({
        img: 'data:image/png;base64,' + png.toString('base64'),
        dev,
        cssW,
        cssH,
        statusH,
        urlH,
        navH,
        dark: opt.theme === 'dark',
        time: clock(),
        urlText: opt.url || '127.0.0.1:8000',
    });
    const created = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    const { ws, send } = await connect(created.webSocketDebuggerUrl);
    try {
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', {
            width: cssW, height: cssH, deviceScaleFactor: dev.dpr, mobile: false,
        });
        const tree = await send('Page.getFrameTree');
        const frameId = tree.frameTree.frame.id;
        await send('Page.setDocumentContent', { frameId, html });
        await sleep(400);
        const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        return Buffer.from(shot.data, 'base64');
    } finally {
        ws.close();
        await fetch('http://127.0.0.1:' + port + '/json/close/' + created.id).catch(() => {});
    }
}
