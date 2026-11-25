#!/usr/bin/env node
/**
 * 净化透视弹窗「顶栏 / ⋮ 菜单镜像互斥」9224 端口浏览器回归测试。
 *
 * 守的就是用户感受得到的行为：顶栏上有的功能，⋮ 菜单里不许重复；
 * 顶栏被手机断点收起的功能（全文模式），必须在 ⋮ 菜单里露出。
 * 撤回态的全文模式改为置灰常驻、不再隐藏，因此不再算「收进菜单」的情形。
 * 顶栏动作镜像下方不加分隔线。
 *
 * 关键背景：菜单打开时会被 popover.js portal 到 <body>，任何依赖
 * #blai-diff-modal 祖先的 CSS 选择器都会失效。所以本测试在菜单「打开后」
 * 实测计算样式，而不是读源码里的 CSS 文本——后者是曾经骗过人的形式主义。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-diff-menu.mjs
 * 失败时进程退出码 1，并打印逐项期望/实际，便于定位。
 */
import {
    connect, evaluate, waitFor, reloadAndWait, ensurePageFresh, capture, check as harnessCheck,
} from './_harness.mjs';

const HEADER_IDS = [
    'blai-diff-pick-toggle',
    'blai-diff-revert-toggle',
    'blai-diff-mode-toggle',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
// 适配旧调用顺序，判定实现仍只有 harness 一处。
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);

const READY = `(() => {
    const b = document.querySelector('.blai-diff-btn-bottom');
    return document.readyState === 'complete' && !!b && b.offsetParent !== null;
})()`;
const OPEN_MODAL = `(() => {
    const modal = document.getElementById('blai-diff-modal');
    if (!modal) return false;
    if (getComputedStyle(modal).display === 'none') document.querySelector('.blai-diff-btn-bottom')?.click();
    return getComputedStyle(modal).display !== 'none';
})()`;

// 在给定视口下，通过 9224 端口浏览器打开弹窗与菜单，返回顶栏/镜像的可见性快照。
async function snapshot(send, width, height, { fresh = false } = {}) {
    await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
    });
    // 首个场景按需刷新；第二个场景必须重载，清掉上一视口残留的 inline style，否则互斥判定会读脏。
    if (fresh) await ensurePageFresh(send, READY, '页面就绪且 diff 入口可点');
    else await reloadAndWait(send, READY, '页面就绪且 diff 入口可点');
    await waitFor(send, OPEN_MODAL, `${width}px: 透视弹窗未能打开`, 15, 300);

    // 真点击 ⋮，走 openDiffActionsMenu 的完整逻辑（含 portal + 可见性同步）。
    return evaluate(send, `(() => {
        const toggle = document.getElementById('blai-diff-menu-toggle');
        const menu = document.getElementById('blai-diff-actions-menu');
        toggle.click();
        const headerVisible = ${JSON.stringify(HEADER_IDS)}.map(id => {
            const b = document.getElementById(id);
            return !!b && b.offsetParent !== null && getComputedStyle(b).display !== 'none';
        });
        const mirrors = Array.from(document.querySelectorAll('.blai-diff-menu-action')).map(i => {
            const act = i.getAttribute('data-blai-header-action');
            const idx = ${JSON.stringify(HEADER_IDS)}.indexOf(act);
            return { act, idx, visible: getComputedStyle(i).display !== 'none', headerVisible: headerVisible[idx] };
        }).filter(m => m.idx >= 0);
        const divider = menu.querySelector('.blai-diff-menu-divider');
        return {
            innerW: innerWidth,
            menuInBody: menu.parentElement === document.body,
            // AI 改写入口已移除，重新净化按 AI 开关自动串接；这里守住旧 DOM 不回归。
            aiRewriteGone: !document.getElementById('blai-diff-ai-rewrite')
                && !document.querySelector('[data-blai-header-action="blai-diff-ai-rewrite"]'),
            headerVisible,
            mirrors,
            dividerVisible: getComputedStyle(divider).display !== 'none',
            anyMirrorVisible: mirrors.some(m => m.visible),
        };
    })()`);
}

function assertSnapshot(label, snap) {
    if (!snap.menuInBody) check(`${label} 菜单被 portal 到 body`, false, '测试前提不成立');
    if (!snap.aiRewriteGone) check(`${label} AI 改写按钮已移除`, false, '仍存在，应由重新净化自动串接');
    snap.mirrors.forEach((m) => {
        // 核心规则：顶栏可见 ⇔ 菜单镜像隐藏（严格互斥）。
        check(`${label} ${m.act.replace('blai-diff-', '')} 顶栏/菜单互斥`,
            m.headerVisible !== m.visible,
            `header=${m.headerVisible} menu=${m.visible}`);
    });
    // 顶栏动作镜像下方不再加分隔线：手机端全文模式收进菜单后，直接与偏好项相邻。
    check(`${label} 顶栏镜像下方无分隔线`, !snap.dividerVisible);
}

async function main() {
    const { ws, send } = await connect();
    try {
        const cases = [
            { label: '桌面 1280', width: 1280, height: 800 },
            { label: '手机 390', width: 390, height: 844 },
        ];
        for (const [index, c] of cases.entries()) {
            const snap = await snapshot(send, c.width, c.height, { fresh: index === 0 });
            console.log(`\n[${c.label}] viewport=${snap.innerW}px  menuInBody=${snap.menuInBody}`);
            console.log('  顶栏可见:', snap.headerVisible.map((v, i) => `${HEADER_IDS[i].replace('blai-diff-', '')}=${v}`).join(' '));
            console.log('  菜单镜像:', snap.mirrors.map(m => `${m.act.replace('blai-diff-', '')}=${m.visible ? '显' : '隐'}`).join(' '));
            assertSnapshot(c.label, snap);
            const errors = await evaluate(send, `(window.__stProbeErrors || []).slice()`);
            check(`${c.label} 无控制台报错`, errors.length === 0, errors.join(' | '));
            const shot = await capture(send, `verify-diff-menu-${c.width}.png`, {
                expectOpen: ['#blai-diff-modal', '#blai-diff-actions-menu'],
                state: { label: c.label, headerVisible: snap.headerVisible },
            });
            console.log('  截图:', shot);
        }
    } finally {
        await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        ws.close();
    }
    if (failures.length) {
        console.error(`\n验证失败：${failures.length} 项未通过`);
        process.exit(1);
    }
    console.log(`\n全部通过：顶栏与 ⋮ 菜单无重复、无遗漏。`);
}

main().catch((e) => {
    console.error('验证异常:', e.message);
    process.exit(2);
});
