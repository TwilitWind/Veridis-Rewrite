#!/usr/bin/env node
/**
 * 手机端排版回归：
 *   1) 五个语义字号档在 390px 下为 12/14/15/16/18px，开关文字跟随 note 档；
 *   2) 「启用 AI 改写」「自动触发 AI 改写」同排、整组左对齐，开关紧跟各自文字；
 *   3) 两个开关位于 API 预设上方；
 *   4) 首页规则卡外边距 12px，主界面底栏上下内边距 8px。
 *
 * 关键顺序：主界面默认 display:none，必须先点入口打开，再切到 AI 页；
 * 只点 [data-page-target="ai"] 时祖先仍然隐藏，量到的矩形全是 0。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-ai-mobile.mjs
 * 失败退出码 1。需要 SillyTavern(8000) 与调试浏览器均已启动。
 */
import {
    connect, evaluate, waitFor, ensurePageFresh, capture, check as harnessCheck,
} from './_harness.mjs';

const failures = [];
// 适配旧调用顺序，判定实现仍只有 harness 一处。
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);

const READY = `(() => !!document.getElementById('blai-purifier-popup')
    && !!document.querySelector('#blai-purifier-popup [data-page-target="ai"]')
    && typeof jQuery !== 'undefined')()`;

async function openAiPage(send) {
    const opened = await evaluate(send, `(() => {
        const entry = document.getElementById('blai-wand-btn') || document.getElementById('blai-wand-btn-panel');
        entry?.click();
        return !!entry;
    })()`);
    if (!opened) throw new Error('找不到插件入口按钮');
    await waitFor(send, `(() => {
        const popup = document.getElementById('blai-purifier-popup');
        return popup && getComputedStyle(popup).display !== 'none';
    })()`, '主界面未显示', 25, 300);
    await evaluate(send, `(() => { document.querySelector('#blai-purifier-popup [data-page-target="ai"]')?.click(); return true; })()`);
    await waitFor(send, `(() => {
        const el = document.querySelector('#blai-purifier-popup .blai-ai-connection-header');
        return !!el && el.getBoundingClientRect().height > 0;
    })()`, 'AI 页未显示', 25, 300);
}

const readData = `(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => {
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
    };
    const popup = q('#blai-purifier-popup');
    const root = getComputedStyle(document.documentElement);
    const tokens = ['note', 'body', 'sub', 'title', 'hero'].map((k) => root.getPropertyValue('--blai-fs-' + k).trim());
    const switches = [...document.querySelectorAll('.blai-ai-rewrite-switches .blai-ai-switch')];
    const parts = switches.map((el) => ({
        box: box(el),
        text: box(el.querySelector('span:not(.blai-ai-switch-track)')),
        track: box(el.querySelector('.blai-ai-switch-track')),
        fontSize: getComputedStyle(el).fontSize,
    }));
    const header = q('.blai-ai-connection-header');
    const apiBox = box(q('.blai-ai-api-preset-field'));
    const switchesBox = box(q('.blai-ai-rewrite-switches'));
    const rulesStyle = getComputedStyle(q('.blai-home-rules'));
    const navStyle = getComputedStyle(q('.bottom-nav'));
    return {
        popupDisplay: getComputedStyle(popup).display,
        tokens,
        parts,
        header: box(header),
        switches: switchesBox,
        api: apiBox,
        gaps: parts.map((p) => p.track.left - p.text.right),
        leftAligned: parts[0].box.left - switchesBox.left <= 1 && parts[0].box.left <= parts[1].box.left,
        homeMargin: [rulesStyle.marginLeft, rulesStyle.marginRight],
        navPadY: [navStyle.paddingTop, navStyle.paddingBottom],
        sameRow: Math.abs(parts[0].track.top - parts[1].track.top) <= 2,
        aboveApi: switchesBox.bottom <= apiBox.top,
        textBeforeTrack: parts.every((p) => p.text.right <= p.track.left),
        noOverlap: parts[0].box.right <= parts[1].box.left,
        withinHeader: switchesBox.left >= box(header).left - 1 && switchesBox.right <= box(header).right + 1,
    };
})()`;

// 状态源用父元素自定义属性 + justify-content 判定；Chrome 对伪元素 computed transform/margin 不可靠。
const readSwitchStates = `(async () => {
    const inputs = [...document.querySelectorAll('.blai-ai-rewrite-switches input[type="checkbox"]')];
    if (inputs.length < 2) return [];
    const originals = inputs.map((input) => input.checked);
    const setChecked = (input, checked) => {
        input.checked = checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setChecked(inputs[0], false);
    setChecked(inputs[1], true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rows = inputs.map((input) => {
        const track = input.parentElement.querySelector('.blai-ai-switch-track');
        const style = getComputedStyle(track);
        return {
            checked: input.checked,
            justify: style.justifyContent,
            offset: style.getPropertyValue('--blai-switch-offset').trim(),
            width: style.width,
            height: style.height,
        };
    });
    inputs.forEach((input, index) => setChecked(input, originals[index]));
    return rows;
})()`;

async function main() {
    const { ws, send } = await connect();
    try {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await ensurePageFresh(send, READY, '页面与插件就绪');
        await openAiPage(send);
        // 酒馆自身加载遮罩在 reload 后可能盖住全屏，与插件层级无关。
        await evaluate(send, `(() => {
            for (const id of ['load-spinner', 'popup-content']) {
                const el = document.getElementById(id);
                if (el) el.style.setProperty('display', 'none', 'important');
            }
            return true;
        })()`);

        const data = await evaluate(send, readData);
        check('主界面已打开', data.popupDisplay !== 'none', data.popupDisplay);
        check('五档字号为手机值', data.tokens.join(',') === '12px,14px,15px,16px,18px', data.tokens.join('/'));
        check('开关文字为 note 档 12px', data.parts.every((p) => p.fontSize === '12px'), data.parts.map((p) => p.fontSize).join('/'));
        check('两个开关同排', data.sameRow, `track top ${data.parts.map((p) => p.track.top).join('/')}`);
        check('文字在左、开关在右', data.textBeforeTrack);
        check('两个开关不重叠', data.noOverlap);
        check('开关组位于 API 预设上方', data.aboveApi, `switches.bottom=${data.switches.bottom} api.top=${data.api.top}`);
        check('开关组落在标题栏宽度内', data.withinHeader);
        check('开关紧跟各自文字', data.gaps.every((g) => g >= 6 && g <= 12), `gaps=${data.gaps.join('/')}`);
        check('开关组左对齐', data.leftAligned, `first=${data.parts[0].box.left} group=${data.switches.left}`);
        check('首页规则卡外边距 12px', data.homeMargin.every((v) => v === '12px'), data.homeMargin.join('/'));
        check('底栏上下内边距 8px', data.navPadY.every((v) => v === '8px'), data.navPadY.join('/'));

        const switchStates = await evaluate(send, readSwitchStates);
        const off = switchStates[0];
        const on = switchStates[1];
        const near = (value, target) => Math.abs(Number.parseFloat(value) - target) <= 0.05;
        const startsAtLeft = (value) => value === 'flex-start' || value === 'flow-start' || value === 'start';
        check('关闭态圆点靠左、开启态圆点靠右',
            off?.checked === false && startsAtLeft(off?.justify) && off?.offset === '0px'
            && on?.checked === true && startsAtLeft(on?.justify) && on?.offset.includes('100% - 14px'),
            JSON.stringify(switchStates));
        check('开关轨道尺寸 32×18', switchStates.length === 2 && switchStates.every((row) => near(row.width, 32) && near(row.height, 18)),
            switchStates.map((row) => `${row.width}×${row.height}`).join('/'));

        const shot = await capture(send, 'verify-ai-mobile.png', {
            expectOpen: ['#blai-purifier-popup'],
            state: { viewport: '390x844', page: 'ai' },
        });
        console.log('截图:', shot);
    } finally {
        await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        ws.close();
    }
    if (failures.length) {
        console.error(`\n验证失败：${failures.length} 项未通过`);
        process.exit(1);
    }
    console.log(`\n验证通过。`);
}

main().catch((e) => {
    console.error('验证异常:', e.message);
    process.exit(2);
});
