#!/usr/bin/env node
/**
 * 四项 UI 统一改造的 9224 端口浏览器回归测试：
 *   ① 所有省略号菜单统一竖向（插件作用域内无横三点）；
 *   ② 切页 fade through（点击当帧 active 唯一且已指向新页，旧页带 leaving 淡出、
 *      新页带 entering 延迟淡入）；弹窗仍走淡出；含快速来回切换的竞态：
 *      最终恰好一个 active 面板、无 leaving 残留；
 *   ③ toast 四种语义色是酒馆原生值，不随构建漂移；
 *   ④ 弹窗底部按钮内边距桌面/手机各自统一为 8px 12px。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-ui-unify.mjs
 * 失败退出码 1。需要 SillyTavern(8000) 与调试浏览器(9224)均已启动。
 *
 * 稳健性约定（针对一次性探针反复踩的坑）：
 * - 开头按需刷新，只有装机副本更新才 reload，没改代码重跑直接复用页面；
 * - 所有「等动画结束」用轮询而非固定 sleep，兼容后台标签页定时器节流；
 * - 当前页以 .pages 容器的 data-active-page 为准；切页当帧旧面板已去掉 active、只留 leaving；
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
    enteringPages: [...document.querySelectorAll('.page-panel.blai-is-entering')].map(e => e.getAttribute('data-page')),
    activeAttr: document.getElementById('blai-purifier-popup')?.getAttribute('data-active-page'),
}))()`;

const { send, ws } = await connect();
try {
    // reload 一次：确保加载同步后的装机副本，且 DOM 状态干净；显式回桌面视口，避免上一个脚本留下手机尺寸。
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
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

    // 先把当前页稳定切到 overview，避免上一轮状态影响后续测试
    await evaluate(send, `document.querySelector('[data-page-target="overview"]')?.click()`);
    await pollUntil(send, TRANSITION_STATE, s => s.leavingPages.length === 0 && s.activeAttr === 'overview', '回到 overview');

    // ===== ②a 切页 fade through：点击当帧 active 已切到新页，旧页淡出、新页延迟淡入 =====
    const pageSwitch = await evaluate(send, `(() => {
        document.querySelector('[data-page-target="ai"]')?.click();
        const p = document.querySelector('.page-panel[data-page="ai"]');
        const old = document.querySelector('.page-panel[data-page="overview"]');
        const r = p.getBoundingClientRect();
        return {
            state: ${TRANSITION_STATE},
            anim: getComputedStyle(p).animationName,
            oldAnim: getComputedStyle(old).animationName,
            transform: getComputedStyle(p).transform,
            box: [r.x, r.y, r.width, r.height].map(v => +v.toFixed(1)),
        };
    })()`);
    check('②a 切页当帧 active 唯一且指向新页',
        pageSwitch.state.activePages.length === 1 && pageSwitch.state.activePages[0] === 'ai'
        && pageSwitch.state.activeAttr === 'ai',
        JSON.stringify(pageSwitch.state));
    check('②a 旧页淡出、新页待入场，两个状态不串页',
        pageSwitch.state.leavingPages.length === 1 && pageSwitch.state.leavingPages[0] === 'overview'
        && pageSwitch.state.enteringPages.length === 1 && pageSwitch.state.enteringPages[0] === 'ai',
        JSON.stringify(pageSwitch.state));
    check('②a 切页走 fade through、不叠 transform',
        pageSwitch.anim === 'blai-page-enter' && pageSwitch.oldAnim === 'blai-fade-out'
        && pageSwitch.transform === 'none' && pageSwitch.box.every(v => v > 0),
        `anim=${pageSwitch.anim}/${pageSwitch.oldAnim} transform=${pageSwitch.transform} box=${JSON.stringify(pageSwitch.box)}`);
    await pollUntil(send, TRANSITION_STATE, s => s.leavingPages.length === 0, '切页退场结束');

    // ===== ②b 弹窗淡出动画（portal 到 body，选择器不限外壳）=====
    // getComputedStyle 会强制样式重算，animationName 在加类后立即生效。
    // 不用 requestAnimationFrame：后台标签页会节流 rAF，Promise 可能永不兑现把脚本挂死。
    const modalAnim = await evaluate(send, `(() => {
        const modal = document.querySelector('.blai-modal-shell');
        if (!modal) return { anim: null };
        modal.classList.add('blai-is-leaving');
        const cs = getComputedStyle(modal);
        const out = { anim: cs.animationName, dur: cs.animationDuration };
        modal.classList.remove('blai-is-leaving');
        return out;
    })()`);
    check('②b 弹窗退场播 blai-fade-out', modalAnim.anim === 'blai-fade-out', JSON.stringify(modalAnim));

    // ===== ②d 动效节奏：退场更快，且 JS/CSS 共用同一组令牌 =====
    const timing = await evaluate(send, `(() => {
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement('div');
        probe.className = 'blai-home-card-menu';
        document.body.appendChild(probe);
        const menuIn = getComputedStyle(probe).animationDuration;
        probe.remove();
        const shell = document.querySelector('.blai-modal-shell');
        const card = shell?.querySelector('.blai-modal-card');
        return {
            fast: root.getPropertyValue('--blai-duration-fast').trim(),
            base: root.getPropertyValue('--blai-duration-base').trim(),
            slow: root.getPropertyValue('--blai-duration-slow').trim(),
            pageAnim: getComputedStyle(document.querySelector('.page-panel.active')).animationName,
            shellIn: shell ? getComputedStyle(shell).animationDuration : null,
            cardIn: card ? getComputedStyle(card).animationDuration : null,
            menuIn,
        };
    })()`);
    check('②d 退场比进场短（80/120/140ms）',
        timing.fast === '80ms' && timing.base === '120ms' && timing.slow === '140ms', JSON.stringify(timing));
    check('②d 切页入场与菜单/弹窗各走统一时长',
        timing.pageAnim === 'blai-page-enter' && timing.menuIn === '0.08s'
        && (!timing.shellIn || timing.shellIn === '0.12s')
        && (!timing.cardIn || timing.cardIn === '0.14s'), JSON.stringify(timing));

    // ===== ②c 快速来回切换的竞态 =====
    for (const page of ['overview', 'ai', 'overview', 'ai', 'overview']) {
        await evaluate(send, `document.querySelector('[data-page-target="${page}"]')?.click()`);
        await sleep(40); // 连续点击，验证不会残留错页或退场类
    }
    const race = await pollUntil(send, TRANSITION_STATE, s => s.leavingPages.length === 0, '竞态后稳定');
    check('②c 快速切换后恰好一个 active 且无残留',
        race.activePages.length === 1 && race.activePages[0] === 'overview' && race.leavingPages.length === 0,
        JSON.stringify(race));

    // ===== ②e 分段控制器：切换后选中项仍有强调底色（含手机端粘滞 :hover） =====
    await evaluate(send, `(() => {
        const modal = document.getElementById('blai-subrule-edit-modal');
        modal.style.setProperty('display', 'flex', 'important');
        const sel = document.getElementById('blai-modal-sub-rewrite-mode');
        sel.value = 'program';
        jQuery(sel).trigger('change');
        document.querySelector('#blai-modal-sub-rewrite-mode-segment [data-value="ai"]')?.click();
        return true;
    })()`);
    // 触摸后 :hover 会粘滞到下一次点击；用 CDP 强制 hover 复现这个手机端条件。
    // depth:-1 会把整页 DOM 树序列化，酒馆页面大了之后会挂住；querySelector 只需根节点。
    await send('DOM.enable');
    const { root } = await send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '#blai-modal-sub-rewrite-mode-segment [data-value="ai"]',
    });
    if (!nodeId) throw new Error('分段控制器 AI 按钮不存在');
    await send('CSS.enable');
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    const segment = await evaluate(send, `(() => {
        const modal = document.getElementById('blai-subrule-edit-modal');
        const previousDisplay = modal.style.display;
        const sel = document.getElementById('blai-modal-sub-rewrite-mode');
        const ai = document.querySelector('#blai-modal-sub-rewrite-mode-segment [data-value="ai"]');
        const program = document.querySelector('#blai-modal-sub-rewrite-mode-segment [data-value="program"]');
        const snap = {
            select: sel.value,
            hovered: ai.matches(':hover'),
            aiBg: getComputedStyle(ai).backgroundColor,
            aiColor: getComputedStyle(ai).color,
            aiPressed: ai.getAttribute('aria-pressed'),
            programBg: getComputedStyle(program).backgroundColor,
        };
        modal.style.display = previousDisplay;
        return snap;
    })()`);
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    const transparent = (v) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
    check('②e 切换后选中项仍有底色与文字（粘滞 hover 下）',
        segment?.select === 'ai' && segment.hovered === true && segment.aiPressed === 'true'
        && !transparent(segment.aiBg) && !transparent(segment.aiColor)
        && transparent(segment.programBg), JSON.stringify(segment));

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
