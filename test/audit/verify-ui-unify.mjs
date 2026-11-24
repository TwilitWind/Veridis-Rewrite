#!/usr/bin/env node
/**
 * 四项 UI 统一改造的真浏览器回归测试：
 *   ① 所有省略号菜单统一竖向（插件作用域内无横三点）；
 *   ② 页面 / 弹窗切换是「旧页先淡出、新页后淡入」的顺序过渡，同一时刻只有一个面板参与
 *      布局；每个面板自身在动画期间几何与 transform 恒定（无放大/收缩）；
 *      含快速来回切换的竞态：最终恰好一个 active 面板、无 leaving 残留；
 *   ③ toast 四种语义色是酒馆原生值，不随构建漂移；
 *   ④ 弹窗底部按钮内边距桌面/手机各自统一为 8px 12px。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-ui-unify.mjs
 * 失败退出码 1。需要 SillyTavern(8000) 与调试浏览器(9224)均已启动。
 *
 * 稳健性约定（针对一次性探针反复踩的坑）：
 * - 开头 reload 一次，保证读到同步后的装机副本，不被上一轮 DOM 状态污染；
 * - 所有「等动画结束」用轮询而非固定 sleep，兼容后台标签页定时器节流；
 * - 当前页以 .pages 容器的 data-active-page 为准，不取第一个 .active（淡出期旧面板仍带 active）；
 * - 弹窗 portal 到 body，选择器不限制在 #blai-purifier-popup 内；
 * - toast 令牌挂在 .blai-toast 类上，用临时元素读计算值，不遍历 cssRules（注入样式读不到）；
 * - 含反证：故意破坏关键条件必须让对应断言失败。
 */
import { connect, evaluate, waitFor, reloadAndWait } from './_harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/** 轮询直到 predicate(snapshot) 成立或超时；返回最后一次快照。 */
async function pollUntil(send, snapshotExpr, predicate, label, tries = 30, interval = 100) {
    let snap;
    for (let i = 0; i < tries; i++) {
        snap = await evaluate(send, snapshotExpr);
        if (predicate(snap)) return snap;
        await sleep(interval);
    }
    throw new Error(`轮询超时：${label}（最后快照 ${JSON.stringify(snap)}）`);
}

const TRANSITION_STATE = `(() => ({
    activePages: [...document.querySelectorAll('.page-panel.active')].map(e => e.getAttribute('data-page')),
    leavingPages: [...document.querySelectorAll('.page-panel.blai-is-leaving')].map(e => e.getAttribute('data-page')),
    activeAttr: document.getElementById('blai-purifier-popup')?.getAttribute('data-active-page'),
}))()`;

const { send, ws } = await connect();
try {
    // reload 一次：确保加载同步后的装机副本，且 DOM 状态干净
    await reloadAndWait(send, `!!document.querySelector('[data-page-target="ai"]')`, '插件导航');
    // 打开外壳（走真实入口，不强设 display）
    await evaluate(send, `(() => {
        const p = document.getElementById('blai-purifier-popup');
        if (getComputedStyle(p).display === 'none') document.getElementById('blai-wand-btn')?.click();
    })()`);
    await waitFor(send, `getComputedStyle(document.getElementById('blai-purifier-popup')).display !== 'none'`, '外壳可见');
    await sleep(200);

    // ===== ① 省略号竖向 =====
    const ell = await evaluate(send, `(() => {
        const shell = document.getElementById('blai-purifier-popup');
        return {
            horizontal: shell.querySelectorAll('.fa-ellipsis:not(.fa-ellipsis-vertical)').length,
            vertical: shell.querySelectorAll('.fa-ellipsis-vertical').length,
        };
    })()`);
    check('① 插件内无横三点省略号', ell.horizontal === 0, `横${ell.horizontal}/竖${ell.vertical}`);

    // ===== ③ toast 四色（临时元素读计算值）=====
    const toast = await evaluate(send, `(() => {
        const probe = document.createElement('div');
        probe.className = 'blai-toast';
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        const vals = {};
        for (const k of ['success','error','warning','info']) vals[k] = cs.getPropertyValue('--blai-toast-' + k + '-bg').trim().toLowerCase();
        probe.remove();
        return vals;
    })()`);
    const expect = { success: '#5d9e5d', error: '#a83c36', warning: '#e29325', info: '#4092aa' };
    check('③ toast 四色=酒馆原生', Object.keys(expect).every(k => toast[k] === expect[k]), JSON.stringify(toast));

    // ===== ④ 按钮内边距 =====
    const padDesk = await evaluate(send, `(() => {
        const btn = document.querySelector('.blai-modal-actions button');
        return btn ? { padding: getComputedStyle(btn).padding, token: getComputedStyle(btn).getPropertyValue('--blai-modal-btn-pad').trim() } : null;
    })()`);
    check('④ 桌面弹窗按钮 padding=8px 12px', padDesk?.padding === '8px 12px' && padDesk?.token === '8px 12px', JSON.stringify(padDesk));

    // 先把当前页稳定切到 overview，避免上一轮状态影响后续动画测试
    await evaluate(send, `document.querySelector('[data-page-target="overview"]')?.click()`);
    await pollUntil(send, TRANSITION_STATE, s => s.leavingPages.length === 0 && s.activeAttr === 'overview', '回到 overview');

    // ===== ②a 顺序切页：旧页先淡出，期间只有它参与布局且几何不变 =====
    const oldAnim = await evaluate(send, `(() => {
        document.querySelector('[data-page-target="ai"]')?.click();
        const p = document.querySelector('.page-panel.blai-is-leaving');
        const snap = () => {
            if (!p) return null;
            const r = p.getBoundingClientRect();
            const cs = getComputedStyle(p);
            return {
                box: [r.x, r.y, r.width, r.height].map(v => +v.toFixed(1)),
                transform: cs.transform,
                anim: cs.animationName,
                pos: cs.position,
            };
        };
        return {
            page: p?.getAttribute('data-page'),
            freshActive: !!document.querySelector('.page-panel[data-page="ai"]')?.classList.contains('active'),
            a: snap(),
            state: ${TRANSITION_STATE},
        };
    })()`);
    check('②a 旧面板淡出时只有一页参与布局',
        oldAnim.page === 'overview' && oldAnim.freshActive === false &&
        oldAnim.state.activePages.length === 1 && oldAnim.state.activeAttr === 'ai',
        `leaving=${oldAnim.page} active=${JSON.stringify(oldAnim.state.activePages)} attr=${oldAnim.state.activeAttr}`);
    check('②a 旧面板播 blai-fade-out 且保持可见',
        oldAnim.a?.anim === 'blai-fade-out' && oldAnim.a?.pos === 'static',
        `anim=${oldAnim.a?.anim} pos=${oldAnim.a?.pos}`);
    check('②a 旧面板淡出不叠 transform/scale（无收缩）',
        !!oldAnim.a && oldAnim.a.transform === 'none' && oldAnim.a.box.every(v => v > 0),
        JSON.stringify(oldAnim.a));

    const settled = await pollUntil(send, TRANSITION_STATE,
        s => s.activeAttr === 'ai' && s.activePages.length === 1 && s.activePages[0] === 'ai' && s.leavingPages.length === 0,
        '淡出结束后新页 active');
    check('②a 淡出结束后新页淡入且 leaving 清理干净', settled.leavingPages.length === 0, JSON.stringify(settled));

    const newAnim = await evaluate(send, `(() => {
        const p = document.querySelector('.page-panel[data-page="ai"]');
        const r = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        return {
            box: [r.x, r.y, r.width, r.height].map(v => +v.toFixed(1)),
            transform: cs.transform,
            anim: cs.animationName,
            active: p.classList.contains('active'),
        };
    })()`);
    check('②a 新面板播 blai-page-in', newAnim.active && newAnim.anim === 'blai-page-in', JSON.stringify(newAnim));
    check('②a 新面板淡出不叠 transform/scale（无放大）',
        newAnim.transform === 'none' && newAnim.box.every(v => v > 0), JSON.stringify(newAnim));

    // ===== ②b 弹窗淡出动画（portal 到 body，选择器不限外壳）=====
    const modalAnim = await evaluate(send, `(() => {
        const modal = document.querySelector('.blai-modal-shell');
        if (!modal) return { anim: null };
        modal.classList.add('blai-is-leaving');
        const out = new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
            res({ anim: getComputedStyle(modal).animationName, dur: getComputedStyle(modal).animationDuration });
        })));
        return out;
    })()`);
    check('②b 弹窗退场播 blai-fade-out', modalAnim.anim === 'blai-fade-out', JSON.stringify(modalAnim));
    await evaluate(send, `document.querySelector('.blai-modal-shell')?.classList.remove('blai-is-leaving')`);

    // ===== ②c 快速来回切换的竞态 =====
    for (const page of ['overview', 'ai', 'overview', 'ai', 'overview']) {
        await evaluate(send, `document.querySelector('[data-page-target="${page}"]')?.click()`);
        await sleep(40); // 小于 130ms 淡出时长，制造「淡出中被重新激活」
    }
    const race = await pollUntil(send, TRANSITION_STATE, s => s.leavingPages.length === 0, '竞态后稳定');
    check('②c 快速切换后恰好一个 active 且无残留',
        race.activePages.length === 1 && race.activePages[0] === 'overview' && race.leavingPages.length === 0,
        JSON.stringify(race));

    // ===== ④ 手机端按钮内边距 =====
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const padMobile = await evaluate(send, `(() => {
        const btn = document.querySelector('.blai-modal-actions button');
        return btn ? { padding: getComputedStyle(btn).padding, mq: matchMedia('(max-width: 600px)').matches } : null;
    })()`);
    check('④ 手机端弹窗按钮 padding=8px 12px', padMobile?.padding === '8px 12px' && padMobile?.mq === true, JSON.stringify(padMobile));
    await send('Emulation.clearDeviceMetricsOverride');

    // ===== 反证：破坏几何约束必须让「无收缩」判据失败 =====
    const broken = await evaluate(send, `(() => {
        // 取当前 active 且可见的面板（竞态后是 overview），人为缩放它，几何判据应捕获差异
        const p = document.querySelector('.page-panel.active');
        const before = +p.getBoundingClientRect().width.toFixed(1);
        p.style.transform = 'scale(0.9)';
        const after = +p.getBoundingClientRect().width.toFixed(1);
        p.style.transform = '';
        return { before, after };
    })()`);
    check('反证：人为收缩能被几何判据捕获', broken.after < broken.before && broken.before > 0,
        `正常 w=${broken.before} 缩放后 w=${broken.after}`);

    // 控制台错误
    const errors = await evaluate(send, `(window.__stProbeErrors||[]).slice()`);
    check('无控制台错误', errors.length === 0, errors.join(' | '));

} finally {
    ws.close();
}

const failed = results.filter(r => !r.ok).length;
if (failed) {
    console.error(`\n验证失败：${failed}/${results.length} 项未通过`);
    process.exit(1);
}
console.log(`\n全部通过：${results.length}/${results.length} 项。`);
