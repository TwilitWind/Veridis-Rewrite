#!/usr/bin/env node
/**
 * 净化对比弹窗排版回归：顶栏/工具行成组、提示块与正文分区、正文不粗体、
 * 字号三档循环与重载保持。桌面 + 手机双端；字号设置结束还原。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-diff-typography.mjs
 */
import {
    connect, evaluate, waitFor, reloadAndWait, ensurePageFresh, capture,
    check, assertManagedFilesSynced,
} from './_harness.mjs';
import {
    IPHONE_UA, OPEN_DIFF_MODAL, forceSaveSettings,
    seedDiffMessage, snapshotDiffMessage, restoreDiffMessage,
} from './_diff-fixture.mjs';

const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 种子一条「无改写」的 diff 消息：提示块与正文一定是渲染完成的真实内容，
// 不靠猜 spinner / 加载文案，也不靠脚本强行 display:flex 与宿主异步收起打架。
const seedText = (send, text) => seedDiffMessage(send, { original: text, program: text });

const MEASURE = `(() => {
    const modal = document.getElementById('blai-diff-modal');
    const content = document.getElementById('blai-diff-modal-content');
    const header = modal?.querySelector('.blai-diff-modal-header');
    const toolbar = document.getElementById('blai-diff-toolbar');
    const panel = document.getElementById('blai-diff-filter-panel');
    const divider = document.querySelector('.blai-diff-menu-typography-divider');
    const hs = header ? getComputedStyle(header) : null;
    const ts = toolbar ? getComputedStyle(toolbar) : null;
    const ps = panel ? getComputedStyle(panel) : null;
    const readFont = () => {
        const probe = document.createElement('span');
        probe.style.fontSize = 'var(--blai-diff-body-font-size)';
        (content || modal || document.body).appendChild(probe);
        const size = getComputedStyle(probe).fontSize;
        probe.remove();
        return size;
    };
    const readHint = () => {
        const existing = content?.querySelector('.blai-diff-empty');
        if (existing) {
            const s = getComputedStyle(existing);
            return { bg: s.backgroundColor, border: s.borderTopWidth, weight: s.fontWeight, margin: s.marginBottom };
        }
        const probe = document.createElement('div');
        probe.className = 'blai-diff-empty';
        probe.innerHTML = '<i class="fa-solid fa-circle-info"></i>探针';
        content?.appendChild(probe);
        const s = getComputedStyle(probe);
        const out = { bg: s.backgroundColor, border: s.borderTopWidth, weight: s.fontWeight, margin: s.marginBottom };
        probe.remove();
        return out;
    };
    // 浏览器缩放/DPR 会把 1px 回读成分数，和同页 1px 参考值比，不写死 '1px'。
    const ref1px = (() => {
        const probe = document.createElement('span');
        probe.style.borderTop = '1px solid red';
        (content || modal || document.body).appendChild(probe);
        const w = parseFloat(getComputedStyle(probe).borderTopWidth);
        probe.remove();
        return w;
    })();
    const readWeights = () => {
        const add = (tag, cls) => {
            const el = document.createElement(tag);
            el.className = cls;
            el.textContent = '探针';
            content?.appendChild(el);
            const w = getComputedStyle(el).fontWeight;
            el.remove();
            return w;
        };
        return { ins: add('ins', ''), del: add('del', ''), stat: add('span', 'blai-diff-stat') };
    };
    return {
        title: modal?.querySelector('.blai-diff-title-text')?.textContent || '',
        header: { border: hs?.borderBottomWidth || '', pad: hs ? [hs.paddingLeft, hs.paddingRight] : [] },
        toolbar: { border: ts?.borderBottomWidth || '', pad: ts ? [ts.paddingLeft, ts.paddingRight] : [] },
        panelHidden: panel ? panel.hidden : null,
        panelBorder: ps?.borderBottomWidth || '',
        dividerDisplay: divider ? getComputedStyle(divider).display : 'missing',
        ref1px,
        fontSize: { value: modal?.dataset.diffFontSize || '', label: document.getElementById('blai-diff-font-size-text')?.textContent || '', px: readFont() },
        hint: readHint(),
        weights: readWeights(),
    };
})()`;

const synced = assertManagedFilesSynced();
console.log(`受管文件已同步：${synced}/${synced}`);
const { ws, send } = await connect();
let fontSizeInitial = null;
let msgSnapshot = null;

try {
    await ensurePageFresh(send, `!!document.getElementById('blai-diff-font-size-text') && !!document.getElementById('blai-diff-toolbar')`, '页面就绪');
    msgSnapshot = await snapshotDiffMessage(send);
    for (const sc of [
        { name: '桌面', width: 1280, height: 800, mobile: false },
        { name: '手机', width: 390, height: 844, mobile: true },
    ]) {
        await send('Emulation.setDeviceMetricsOverride', {
            width: sc.width, height: sc.height, deviceScaleFactor: 1, mobile: sc.mobile,
        });
        if (sc.mobile) {
            await send('Network.setUserAgentOverride', {
                userAgent: IPHONE_UA, acceptLanguage: 'zh-CN,zh;q=0.9', platform: 'iPhone',
            });
        }
        const pageState = await ensurePageFresh(send, `!!document.getElementById('blai-diff-font-size-text') && !!document.getElementById('blai-diff-toolbar')`, `${sc.name}: 页面就绪`, 120);
        console.log(`[${sc.name}] 页面${pageState === 'reused' ? '复用（未刷新）' : '已刷新'}`);
        await waitFor(send, `(() => { const l = document.getElementById('load-spinner'); return !l || l.offsetParent === null; })()`, `${sc.name}: 酒馆加载结束`, 120, 300);
        await seedText(send, '<content>甲乙丙丁</content>');
        await waitFor(send, OPEN_DIFF_MODAL, `${sc.name}: 透视弹窗打开`, 30, 300);
        // 确定性完成信号：正文里出现真实提示块，而不是猜 spinner / 加载文案。
        await waitFor(send, `!!document.querySelector('#blai-diff-modal-content .blai-diff-empty')`, `${sc.name}: 对比渲染完成`, 60, 300);
        const r = await evaluate(send, MEASURE);

        check(failures, `${sc.name}: 标题为「净化对比」`, r.title === '净化对比', r.title);
        check(failures, `${sc.name}: 顶栏不画分隔线`, r.header.border === '0px', r.header.border);
        check(failures, `${sc.name}: 分隔线在工具行下方`,
            Math.abs(parseFloat(r.toolbar.border) - r.ref1px) < 0.02, `${r.toolbar.border} / 参考 ${r.ref1px}px`);
        const expectedPad = sc.mobile ? '8px' : '12px';
        check(failures, `${sc.name}: 顶栏与工具行左右对齐且档位正确`,
            r.header.pad.join('/') === r.toolbar.pad.join('/') && r.header.pad.every(v => v === expectedPad),
            `${r.header.pad} vs ${r.toolbar.pad}，期望 ${expectedPad}`);
        check(failures, `${sc.name}: 筛选折叠时线不在面板下方`,
            r.panelHidden === true && r.panelBorder === '0px', `hidden=${r.panelHidden} border=${r.panelBorder}`);
        check(failures, `${sc.name}: 字号分组线始终可见`, r.dividerDisplay !== 'none' && r.dividerDisplay !== 'missing', r.dividerDisplay);
        check(failures, `${sc.name}: 提示块与正文分区`,
            r.hint.bg !== 'rgba(0, 0, 0, 0)'
            && Math.abs(parseFloat(r.hint.border) - r.ref1px) < 0.02 && r.hint.weight === '400',
            `${JSON.stringify(r.hint)} / 参考 ${r.ref1px}px`);
        check(failures, `${sc.name}: del/ins/计数均不粗体`,
            r.weights.ins === '400' && r.weights.del === '400' && r.weights.stat === '400', JSON.stringify(r.weights));
        check(failures, `${sc.name}: 字号档位与文案同步`,
            ['small', 'medium', 'large'].includes(r.fontSize.value)
            && r.fontSize.label === `字号${{ small: '小', medium: '中', large: '大' }[r.fontSize.value]}`,
            JSON.stringify(r.fontSize));

        if (!sc.mobile) {
            fontSizeInitial = r.fontSize.value;
            const order = ['small', 'medium', 'large'];
            const sizes = new Set([r.fontSize.px]);
            for (let i = 0; i < 3; i++) {
                const expected = order[(order.indexOf(r.fontSize.value) + 1) % 3];
                await evaluate(send, `(() => { document.getElementById('blai-diff-font-size-toggle')?.click(); return true; })()`);
                await sleep(150);
                const next = await evaluate(send, MEASURE);
                sizes.add(next.fontSize.px);
                check(failures, `桌面: 第 ${i + 1} 次切换字号生效`,
                    next.fontSize.value === expected, `期望 ${expected}，实际 ${JSON.stringify(next.fontSize)}`);
                r.fontSize.value = next.fontSize.value;
            }
            check(failures, '桌面: 三档字号给出三种实际字号', sizes.size === 3, [...sizes].join('/'));
            check(failures, '桌面: 循环三次回到原档位', r.fontSize.value === fontSizeInitial, `${r.fontSize.value} vs ${fontSizeInitial}`);

            // 持久化：设到 large，落盘后重载，重载仍保持；再还原初始设置。
            const toLarge = (order.indexOf('large') - order.indexOf(fontSizeInitial) + 3) % 3;
            for (let i = 0; i < toLarge; i++) {
                await evaluate(send, `(() => { document.getElementById('blai-diff-font-size-toggle')?.click(); return true; })()`);
            }
            await sleep(150);
            await forceSaveSettings(send);
            const before = await evaluate(send, `({ v: document.getElementById('blai-diff-modal')?.dataset.diffFontSize || '', label: document.getElementById('blai-diff-font-size-text')?.textContent || '' })`);
            check(failures, '桌面: 字号写回设置对象', before.v === 'large' && before.label === '字号大', JSON.stringify(before));
            await reloadAndWait(send, `!!document.getElementById('blai-diff-font-size-text')`, '重载检查持久化', 120);
            await waitFor(send, `(() => { const l = document.getElementById('load-spinner'); return !l || l.offsetParent === null; })()`, '重载后加载结束', 120, 300);
            const after = await evaluate(send, `({ v: document.getElementById('blai-diff-modal')?.dataset.diffFontSize || '', label: document.getElementById('blai-diff-font-size-text')?.textContent || '' })`);
            check(failures, '桌面: 重载后字号仍保持', after.v === 'large' && after.label === '字号大', JSON.stringify(after));
            const backSteps = (order.indexOf(fontSizeInitial) - order.indexOf('large') + 3) % 3;
            for (let i = 0; i < backSteps; i++) {
                await evaluate(send, `(() => { document.getElementById('blai-diff-font-size-toggle')?.click(); return true; })()`);
            }
            await sleep(150);
            await forceSaveSettings(send);
            // 不必重载：还原后的设置已在内存中，截图前会重新种子覆盖消息状态。
        }

        // 截图统一重新种子并打开：commitCurrentMessageText 会触发消息列表异步重渲染，
        // 若不等它稳定，会把刚打开的弹窗关掉，capture 的多次求值正好撞上这个窗口。
        // seed → 等重渲染完成 → open → 等真实正文 → 拍，四步缺一不可。
        await seedText(send, '<content>甲乙丙丁</content>');
        await sleep(1500);
        await waitFor(send, OPEN_DIFF_MODAL, `${sc.name}: 出图前弹窗可见`, 30, 300);
        await waitFor(send, `!!document.querySelector('#blai-diff-modal-content .blai-diff-empty')`, `${sc.name}: 出图前正文就绪`, 30, 300);
        await sleep(400);
        const shot = await capture(send, `verify-diff-typography-${sc.mobile ? 'mobile' : 'desktop'}.png`, { expectOpen: ['#blai-diff-modal-content'] });
        console.log(`[${sc.name}] 截图 ${shot}；字号 ${r.fontSize.px}`);
    }
} finally {
    if (msgSnapshot) await restoreDiffMessage(send, msgSnapshot).catch(() => {});
    try { await send('Emulation.clearDeviceMetricsOverride'); } catch {}
    try { await send('Network.setUserAgentOverride', { userAgent: '' }); } catch {}
    ws.close();
}

if (failures.length) {
    console.error(`失败 ${failures.length} 项：\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('净化对比排版回归：双端全部通过');
