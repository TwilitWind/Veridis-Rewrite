// 运行时布局审计：文字裁切 / 元素重叠 / 遮挡 / 实际渲染字号，桌面与手机同会话测完。
// 前置：SillyTavern 已在本地运行，且有一个开了 --remote-debugging-port=9224 的 Chrome。
// 用法：node test/layout-audit.mjs
//   CDP_PORT=9224        调试端口
//   SCOPE=#blai-purifier-popup  审计范围
//   OUT=report.json      另存结构化结果
//   MOBILE_W=390 MOBILE_H=844  手机视口
//   NO_MOBILE=1          只测桌面
//   PAGES=all(default)|current  默认遍历所有标签页；current 只测当前激活页
// 只读：不改源文件；只在页面里临时打开面板、切页、切视口，退出时还原。
// 信噪比设计：故意裁切（省略号 / 无障碍隐藏 / 滚动容器）归入 intentional，不进问题清单。
// 覆盖设计：默认逐页激活每个 .page-panel 再测，避免「只测当前页」漏掉 AI/净化等非首页区块。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'styles');
const PORT = process.env.CDP_PORT ?? '9224';
const SCOPE = process.env.SCOPE ?? '#blai-purifier-popup';
const MOBILE_W = Number(process.env.MOBILE_W ?? 390);
const MOBILE_H = Number(process.env.MOBILE_H ?? 844);
const NO_MOBILE = process.env.NO_MOBILE === '1';
const PAGES = process.env.PAGES ?? 'all'; // all=遍历所有标签页；current=只测当前激活页
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 字号 token 白名单：用来标记「实际渲染但非设计 token」的字号。
   5 档语义 token（--blai-fs-*）在桌面 :root 与手机 @media 各定义一次，
   两段都收进白名单，否则手机档会被误标成非 token。 */
const scaleText = fs.readFileSync(path.join(STYLES, 'tokens', '03-scale.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const allowedFontPx = new Set(
    [...scaleText.matchAll(/--blai-fs-[\w-]+\s*:\s*([\d.]+)px/g)]
        .map((m) => Number(m[1]))
);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`没有可用的 page target（端口 ${PORT}）`);

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
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');

/* 关键：先清掉上一次运行可能残留的设备模拟（CDP 状态会泄漏到后续所有求值）。
   不重置的话「桌面」读数会是上次的手机视口，整份报告的基线就废了。 */
await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setDeviceMetricsOverride', {
    width: 1353, height: 858, deviceScaleFactor: 1, mobile: false,
});
await sleep(400);

/* 审计函数只注入一次，桌面与手机各调用一次，判定逻辑完全一致 */
const AUDIT = function (scopeSelector) {
    const scope = document.querySelector(scopeSelector);
    if (!scope) return { error: 'scope not found: ' + scopeSelector, viewport: { w: innerWidth, h: innerHeight } };
    const cs = (el) => getComputedStyle(el);
    const vis = (el) => {
        const s = cs(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const hasDirectText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const desc = (el) => {
        const idv = el.id ? '#' + el.id : '';
        const cl = typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        const txt = (el.textContent || '').trim().slice(0, 20);
        return `${el.tagName.toLowerCase()}${idv}${cl}` + (txt ? `「${txt}」` : '');
    };
    const rectOf = (el) => {
        const r = el.getBoundingClientRect();
        return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const all = [...scope.querySelectorAll('*')].filter(vis);

    const fontMap = new Map();
    for (const el of all) {
        const fs = cs(el).fontSize;
        fontMap.set(fs, (fontMap.get(fs) || 0) + 1);
    }

    /* 1) 裁切：分 intentional（设计意图）与 suspicious（需关注） */
    const intentional = [];
    const suspicious = [];
    for (const el of all) {
        const s = cs(el);
        const ox = /hidden|clip/.test(s.overflowX);
        const oy = /hidden|clip/.test(s.overflowY);
        const dx = el.scrollWidth - el.clientWidth;
        const dy = el.scrollHeight - el.clientHeight;
        if (!((ox && dx > 1) || (oy && dy > 1))) continue;
        const row = {
            el: desc(el), rect: rectOf(el),
            dx: +dx.toFixed(1), dy: +dy.toFixed(1),
            hasText: hasDirectText(el),
        };
        let why = null;
        if (el.classList.contains('blai-visually-hidden') ||
            (/absolute/.test(s.position) && row.rect.w <= 1 && row.rect.h <= 1)) {
            why = 'a11y 隐藏（屏幕阅读器专用）';
        } else if (/ellipsis/.test(s.textOverflow) && /nowrap/.test(s.whiteSpace)) {
            why = '省略号单行截断（设计意图）';
        } else if (!row.hasText && dy > 0 && dy <= 12) {
            why = '容器小数级溢出（多为 margin 折叠）';
        } else if (/auto|scroll/.test(s.overflowY) && dy > 0) {
            why = '滚动容器（内容可滚动到）';
        }
        if (why) intentional.push({ ...row, why });
        else suspicious.push(row);
    }

    /* 2) 重叠：全局可见文本元素两两相交（不再按父分组、不再排除 absolute/fixed）。
       历史教训：旧版按 parentElement 分组且跳过绝对定位，导致「说明文字铺满整行、
       absolute 开关压在上面」这类重叠完全漏检（r15 AI 连接区 bug）。
       降噪只保留两条：祖先-后代关系跳过；交集面积需 > 较小元素的 25%。
       absolute/fixed 参与的重叠标注 inFlow:'absolute/fixed'，仍计入问题清单——
       这类正是窄屏浮层压盖的高发来源，宁可多报让人看，也不能再漏。 */
    const textEls = all.filter(hasDirectText);
    const overlap = [];
    const overlapBenign = [];
    for (let i = 0; i < textEls.length; i++) {
        for (let j = i + 1; j < textEls.length; j++) {
            const a = textEls[i], b = textEls[j];
            if (a.contains(b) || b.contains(a)) continue;
            const sa = cs(a), sb = cs(b);
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            const iw = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const ih = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (iw <= 2 || ih <= 2) continue;
            const minArea = Math.min(ra.width * ra.height, rb.width * rb.height);
            if (!minArea) continue;
            const ratio = (iw * ih) / minArea;
            if (ratio <= 0.25) continue;
            const row = {
                a: desc(a), b: desc(b), rectA: rectOf(a), rectB: rectOf(b),
                ratio: +ratio.toFixed(2),
                inFlow: /absolute|fixed/.test(sa.position) || /absolute|fixed/.test(sb.position)
                    ? 'absolute/fixed' : 'normal',
            };
            // 良性压盖：装饰浮层（toast/overlay），或位于 fixed/sticky 祖先内
            //（如手机底部导航栏）——这类滚动后可见，和 occlusion 的 fixed 层判定一致。
            const deco = (el) => {
                if (/toast|overlay|mask|backdrop/i.test(el.className || '')) return true;
                if (el.closest && el.closest('[class*="toast"],[class*="overlay"],[class*="bottom-nav"],[class*="rail-nav"]')) return true;
                let p = el.parentElement;
                while (p && p !== document.body) {
                    if (/fixed|sticky/.test(cs(p).position)) return true;
                    p = p.parentElement;
                }
                return false;
            };
            if (deco(a) || deco(b)) overlapBenign.push({ ...row, why: '固定导航/装饰浮层压盖，滚动后可见' });
            else overlap.push(row);
        }
    }

    /* 3) 遮挡：命中测试，固定层/可滚动容器归为 benign */
    const occlusion = [];
    const occludedBenign = [];
    for (const el of all) {
        if (!hasDirectText(el)) continue;
        const s = cs(el);
        if (s.pointerEvents === 'none' || /absolute|fixed/.test(s.position)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        let hit;
        try { hit = document.elementFromPoint(x, y); } catch { continue; }
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
        const row = { el: desc(el), hit: desc(hit), point: { x: +x.toFixed(1), y: +y.toFixed(1) } };
        let hs = hit;
        let isFixedLayer = false;
        while (hs && hs !== document.body) {
            const p = cs(hs).position;
            if (/fixed|sticky/.test(p)) { isFixedLayer = true; break; }
            hs = hs.parentElement;
        }
        let scrollAncestor = false;
        let pa = el.parentElement;
        while (pa && pa !== document.body) {
            const p = cs(pa);
            if (/auto|scroll/.test(p.overflowY) && pa.scrollHeight > pa.clientHeight + 2) { scrollAncestor = true; break; }
            pa = pa.parentElement;
        }
        if (isFixedLayer) occludedBenign.push({ ...row, why: '固定导航/浮层覆盖，滚动后可见' });
        else if (scrollAncestor) occludedBenign.push({ ...row, why: '位于滚动容器内，非静止遮挡' });
        else occlusion.push(row);
    }

    return {
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        scope: { selector: scopeSelector, ...rectOf(scope) },
        textElementCount: all.filter(hasDirectText).length,
        counts: {
            elements: all.length,
            clippingSuspicious: suspicious.length,
            clippingIntentional: intentional.length,
            overlap: overlap.length,
            overlapBenign: overlapBenign.length,
            occlusion: occlusion.length,
            occlusionBenign: occludedBenign.length,
        },
        fonts: [...fontMap.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])),
        clippingSuspicious: suspicious.slice(0, 50),
        clippingIntentional: intentional.slice(0, 20),
        overlap: overlap.slice(0, 50),
        overlapBenign: overlapBenign.slice(0, 20),
        occlusion: occlusion.slice(0, 50),
        occlusionBenign: occludedBenign.slice(0, 20),
    };
};

async function ensurePanel() {
    return await evaluate(`(() => {
        const p = document.getElementById('blai-purifier-popup');
        if (!p) return { ok:false, reason:'panel missing' };
        if (getComputedStyle(p).display !== 'none') return { ok:true, how:'already-visible' };
        const btn = document.getElementById('blai-wand-btn') || document.getElementById('blai-wand-btn-panel');
        if (btn) { btn.click(); return { ok:true, how:'clicked', id:btn.id }; }
        p.style.setProperty('display','grid','important');
        return { ok:true, how:'forced-display' };
    })()`);
}

const panel = await ensurePanel();
if (!panel.ok) throw new Error('无法打开插件面板：' + panel.reason);
await sleep(500);
if (await evaluate(`getComputedStyle(document.getElementById('blai-purifier-popup')).display === 'none'`)) {
    await evaluate(`document.getElementById('blai-purifier-popup').style.setProperty('display','grid','important')`);
    await sleep(200);
}

const evalAudit = `(${AUDIT.toString()})(${JSON.stringify(SCOPE)})`;

/* 页面列表 + 逐页审计：默认遍历每个 .page-panel，避免只测当前页漏掉 AI/净化等区块。 */
const pageTargets = PAGES === 'all'
    ? await evaluate(`[...document.querySelectorAll('.page-panel')].map(p=>p.dataset.page).filter(Boolean)`)
    : [];
const originalPage = await evaluate(`document.querySelector('.page-panel.active')?.dataset.page || ''`);

const activatePage = async (name) => {
    await evaluate(`(() => { const b=[...document.querySelectorAll('[data-page-target]')].find(x=>x.dataset.pageTarget===${JSON.stringify(name)}); if(b) b.click(); return true; })()`);
    await sleep(150);
};

/* 合并多页结果：counts 求和、问题列表拼接并标注 page、fonts 累加；保留每页明细。 */
const mergePages = (results) => {
    const base = results.find((x) => x.r && !x.r.error)?.r;
    if (!base) return { error: '所有页面审计均失败', _pages: results.map((x) => ({ page: x.page, error: x.r?.error })) };
    const LIST_KEYS = ['clippingSuspicious', 'clippingIntentional', 'overlap', 'overlapBenign', 'occlusion', 'occlusionBenign'];
    const merged = {
        viewport: base.viewport, scope: base.scope,
        textElementCount: 0,
        counts: { elements: 0, clippingSuspicious: 0, clippingIntentional: 0, overlap: 0, overlapBenign: 0, occlusion: 0, occlusionBenign: 0 },
        _pages: results.map((x) => ({ page: x.page, error: x.r?.error || null, counts: x.r?.counts || null })),
    };
    for (const key of LIST_KEYS) merged[key] = [];
    const fontAcc = new Map();
    for (const { page, r } of results) {
        if (!r || r.error) continue;
        merged.textElementCount += r.textElementCount || 0;
        for (const k of Object.keys(merged.counts)) merged.counts[k] += r.counts?.[k] || 0;
        for (const key of LIST_KEYS) for (const item of (r[key] || [])) merged[key].push({ page, ...item });
        for (const [size, count] of (r.fonts || [])) fontAcc.set(size, (fontAcc.get(size) || 0) + count);
    }
    merged.fonts = [...fontAcc.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    return merged;
};

const auditViewport = async () => {
    if (PAGES !== 'all' || !pageTargets.length) return await evaluate(evalAudit);
    const results = [];
    for (const p of pageTargets) {
        await activatePage(p);
        results.push({ page: p, r: await evaluate(evalAudit) });
    }
    if (originalPage) await activatePage(originalPage);
    return mergePages(results);
};

const desktop = await auditViewport();
let mobile = null;
if (!NO_MOBILE) {
    await send('Emulation.setDeviceMetricsOverride', {
        width: MOBILE_W, height: MOBILE_H, deviceScaleFactor: 1, mobile: true,
        screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await sleep(600);
    mobile = await auditViewport();
    await send('Emulation.clearDeviceMetricsOverride');
}

/* 标注非 token 的实际渲染字号 */
const markFonts = (r) => r && !r.error
    ? r.fonts.map(([size, count]) => ({
        size, count,
        isToken: allowedFontPx.has(Number(size.replace('px', ''))),
    }))
    : [];
const dFonts = markFonts(desktop);
const mFonts = markFonts(mobile);

const diff = {};
if (mobile && !desktop.error && !mobile.error) {
    const dm = new Map(dFonts.map((f) => [f.size, f.count]));
    const mm = new Map(mFonts.map((f) => [f.size, f.count]));
    diff.fontChanges = [...new Set([...dm.keys(), ...mm.keys()])]
        .map((k) => ({ size: k, desktop: dm.get(k) || 0, mobile: mm.get(k) || 0 }))
        .filter((r) => r.desktop !== r.mobile)
        .sort((a, b) => parseFloat(b.size) - parseFloat(a.size));
    diff.countChanges = {
        clippingSuspicious: [desktop.counts.clippingSuspicious, mobile.counts.clippingSuspicious],
        overlap: [desktop.counts.overlap, mobile.counts.overlap],
        occlusion: [desktop.counts.occlusion, mobile.counts.occlusion],
    };
    diff.moreIssuesOnMobile = ['clippingSuspicious', 'overlap', 'occlusion']
        .filter((k) => mobile.counts[k] > desktop.counts[k]);
}

const result = {
    meta: { port: PORT, scope: SCOPE, panel, checkedAt: new Date().toISOString(), allowedFontPx: [...allowedFontPx] },
    desktop, mobile, diff,
    fonts: { desktop: dFonts, mobile: mFonts },
};
const out = process.env.OUT;
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
await send('Emulation.clearDeviceMetricsOverride');

console.log('运行时布局审计（桌面 + 手机，同会话）');
console.log('─'.repeat(62));
for (const [label, r] of [['桌面', desktop], ['手机', mobile]]) {
    if (!r) continue;
    if (r.error) { console.log(`${label}：${r.error}`); continue; }
    const c = r.counts;
    console.log(`${label}  ${r.viewport.w}×${r.viewport.h}  面板 ${r.scope.w}×${r.scope.h}  元素 ${c.elements}（直接文本 ${r.textElementCount}）`);
    console.log(`  可疑裁切 ${c.clippingSuspicious} · 重叠 ${c.overlap} · 遮挡 ${c.occlusion}   |   已排除：故意裁切 ${c.clippingIntentional} / 良性重叠 ${c.overlapBenign} / 良性遮挡 ${c.occlusionBenign}`);
    if (PAGES === 'all' && r._pages?.length) {
        const pg = r._pages.map((p) => `${p.page}:裁${p.counts?.clippingSuspicious ?? '?'}重${p.counts?.overlap ?? '?'}遮${p.counts?.occlusion ?? '?'}`).join('  ');
        console.log(`  逐页  ${pg}`);
    }
}
console.log();
console.log('实际渲染字号（标注 * 表示不在 token 白名单）：');
for (const [label, rows] of [['桌面', dFonts], ['手机', mFonts]]) {
    if (!rows.length) continue;
    console.log(`  ${label}：${rows.map((f) => `${f.size}${f.isToken ? '' : '*'}(${f.count})`).join('  ')}`);
}
const nonToken = [...new Set([...dFonts, ...mFonts].filter((f) => !f.isToken).map((f) => f.size))];
if (nonToken.length) console.log(`  → 非 token 渲染字号：${nonToken.join(', ')}（可能来自继承/rem/第三方样式，需人工确认）`);
if (diff.moreIssuesOnMobile?.length) {
    console.log();
    console.log('手机端新增隐患：' + diff.moreIssuesOnMobile.join(', '));
}
for (const [label, r] of [['桌面', desktop], ['手机', mobile]]) {
    if (r?.clippingSuspicious?.length) {
        console.log();
        console.log(`${label}可疑裁切（需看）：`);
        for (const c of r.clippingSuspicious.slice(0, 8)) console.log(`  ${c.el}  dx=${c.dx} dy=${c.dy}`);
    }
    if (r?.overlap?.length) {
        console.log();
        console.log(`${label}可疑重叠（需看）：`);
        for (const o of r.overlap.slice(0, 8)) console.log(`  [${o.page}] ${o.a} × ${o.b}  交叠 ${(o.ratio * 100).toFixed(0)}% (${o.inFlow})`);
    }
    if (r?.occlusion?.length) {
        console.log();
        console.log(`${label}可疑遮挡（需看）：`);
        for (const o of r.occlusion.slice(0, 8)) console.log(`  [${o.page}] ${o.el} <= ${o.hit}`);
    }
}
console.log();
console.log('说明：省略号截断/无障碍隐藏/滚动容器/固定导航覆盖/toast 压盖归为良性；重叠检测覆盖全部标签页且包含 absolute/fixed，保留项为启发式结果。');
if (out) console.log(`结构化结果：${out}`);
ws.close();
