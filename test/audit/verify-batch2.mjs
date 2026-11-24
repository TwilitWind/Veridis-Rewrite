#!/usr/bin/env node
/**
 * 第二批改动的用户可见回归：
 * 1. 手机端输入框聚焦、自绘下拉悬停时边框仍在，且只有一层内描边。
 * 2. API 模型分组「手动填写」在「自动拉取」之前，手动模型可单个清除。
 * 3. 下拉菜单四方向内边距统一、行有圆角、长菜单按 token 限高。
 * 4. 子规则模式选项、toast 关闭按钮使用 Font Awesome 图标，不再靠 Unicode 符号。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-batch2.mjs
 */
import {
    connect, evaluate, waitFor, reloadAndWait, check, capture,
    snapshotState, restoreState, assertManagedFilesSynced, check as harnessCheck,
    snapshotAiSettings, normalizeAiSettings, restoreAiSettings,
} from './_harness.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AI_STATE_SELECTORS = ['#blai-ai-enabled', '#blai-ai-base-url', '#blai-ai-api-key'];
const PORTAL_MENU = '.blai-native-select-menu.blai-portal-menu:not([hidden])';

async function addManualModel(send, modelId) {
    const exists = await evaluate(send, `Array.from(document.querySelectorAll('#blai-ai-model option')).some(o => o.textContent === '${modelId}')`);
    if (exists) return;
    await evaluate(send, `(() => { document.getElementById('blai-ai-model-manual-add')?.click(); return true; })()`);
    await waitFor(send, `!!document.querySelector('.blai-plugin-dialog-input')`, '模型输入弹窗');
    await evaluate(send, `(() => { const i = document.querySelector('.blai-plugin-dialog-input'); i.value = '${modelId}'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await evaluate(send, `(() => { document.querySelector('.blai-plugin-dialog .blai-primary-btn')?.click(); return true; })()`);
    await waitFor(send, `Array.from(document.querySelectorAll('#blai-ai-model option')).some(o => o.textContent === '${modelId}')`, `新增模型 ${modelId}`);
}

async function main() {
    const failures = [];
    const managed = assertManagedFilesSynced();
    console.log(`前置：源码与装机副本 ${managed} 个受管文件一致`);

    const { ws, send } = await connect();
    await send('DOM.enable');
    await send('CSS.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await reloadAndWait(send, `!!document.getElementById('blai-purifier-popup') && typeof jQuery !== 'undefined'`, '页面重载就绪', 120);

    // 先快照真实设置再压到确定性基线；只看表单会把上一次污染误当成原状态。
    const aiBaseline = await snapshotAiSettings(send);
    await normalizeAiSettings(send);
    await sleep(300);

    await waitFor(send, `(() => {
        const e = document.getElementById('blai-wand-btn') || document.getElementById('blai-wand-btn-panel');
        e?.click();
        const p = document.getElementById('blai-purifier-popup');
        return !!p && getComputedStyle(p).display !== 'none';
    })()`, '主界面');
    await evaluate(send, `(() => { document.querySelector('#blai-purifier-popup [data-page-target="ai"]')?.click(); return true; })()`);
    await waitFor(send, `(() => { const el = document.querySelector('#blai-purifier-popup .blai-ai-connection-header'); return !!el && el.getBoundingClientRect().height > 0; })()`, 'AI 页可见');
    await evaluate(send, `(() => {
        const enabled = document.getElementById('blai-ai-enabled');
        if (enabled && enabled.checked) enabled.click();
        for (const [id, value] of [['blai-ai-base-url', ''], ['blai-ai-api-key', '']]) {
            const input = document.getElementById(id);
            if (input) $(input).val(value).trigger('input').trigger('change');
        }
        return true;
    })()`);
    await sleep(200);
    await evaluate(send, `(() => { document.querySelector('.blai-native-select-trigger[aria-expanded="true"]')?.click(); return true; })()`);

    const aiSnapshot = await snapshotState(send, AI_STATE_SELECTORS);
    try {
        // 1. 手机端输入框聚焦：边框色保留、单层 inset ring。
        // 页面装有 Mobile-Focus-Interceptor，脚本 focus() 与重载后的真点击都不稳，
        // 这里强制 :focus 伪类，直接验证样式规则本身。
        const { root } = await send('DOM.getDocument');
        const { nodeId: inputNodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#blai-ai-base-url' });
        if (inputNodeId) await send('CSS.forcePseudoState', { nodeId: inputNodeId, forcedPseudoClasses: ['focus'] });
        await sleep(120);
        const focusState = await evaluate(send, `(() => {
            const i = document.getElementById('blai-ai-base-url');
            const s = getComputedStyle(i);
            return { focused: i.matches(':focus'), border: s.borderColor, shadow: s.boxShadow };
        })()`);
        check(failures, '手机输入框聚焦后边框仍在', focusState.focused && focusState.border !== 'rgba(0, 0, 0, 0)' && focusState.border !== 'transparent', `focused=${focusState.focused} ${focusState.border}`);
        check(failures, '手机输入框聚焦只有一层内描边', focusState.focused && /inset/.test(focusState.shadow) && (focusState.shadow.match(/inset/g) || []).length === 1, `focused=${focusState.focused} ${focusState.shadow}`);
        if (inputNodeId) await send('CSS.forcePseudoState', { nodeId: inputNodeId, forcedPseudoClasses: [] });

        // 1b. 自绘下拉 hover：保持默认边框，不再整圈消失。
        const { nodeId } = await send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: '.blai-ai-model-field .blai-native-select-trigger',
        });
        if (nodeId) await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
        await sleep(100);
        const hoverState = await evaluate(send, `(() => {
            const t = document.querySelector('.blai-ai-model-field .blai-native-select-trigger') || document.querySelector('.blai-native-select-trigger');
            const s = getComputedStyle(t);
            return { border: s.borderColor, shadow: s.boxShadow };
        })()`);
        check(failures, '手机下拉悬停时边框仍在', hoverState.border !== 'rgba(0, 0, 0, 0)' && hoverState.border !== 'transparent', hoverState.border);
        if (nodeId) await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });

        // 2. 手动在前、自动在后；手动模型可单个清除。
        await addManualModel(send, 'audit-manual-1');
        await addManualModel(send, 'audit-manual-2');
        await evaluate(send, `(() => {
            window.__auditHadTavernHelper = Object.prototype.hasOwnProperty.call(window, 'TavernHelper');
            window.__auditOldTavernHelper = window.TavernHelper;
            window.TavernHelper = { getModelList: async () => ['auto-model-a', 'auto-model-b'] };
            const enabled = document.getElementById('blai-ai-enabled');
            if (enabled && !enabled.checked) enabled.click();
            const base = document.getElementById('blai-ai-base-url');
            const key = document.getElementById('blai-ai-api-key');
            if (base) $(base).val('https://mock.local/v1').trigger('input').trigger('change');
            if (key) $(key).val('mock-key').trigger('input').trigger('change');
            return true;
        })()`);
        await sleep(300);
        await evaluate(send, `(() => { document.getElementById('blai-ai-model-fetch')?.click(); return true; })()`);
        await waitFor(send, `Array.from(document.querySelectorAll('#blai-ai-model optgroup')).some(g => g.label === '自动拉取')`, '自动模型分组');
        const groups = await evaluate(send, `Array.from(document.querySelectorAll('#blai-ai-model optgroup')).map(g => g.label)`);
        check(failures, '手动模型分组排在自动拉取之前', groups[0] === '手动填写' && groups[1] === '自动拉取', groups.join(' / '));

        // 3. 下拉四方向 padding、行圆角、max-height 令牌；portal 后从 body 上量。
        await evaluate(send, `(() => {
            const t = document.querySelector('.blai-ai-model-field .blai-native-select-trigger') || document.querySelector('.blai-native-select-trigger');
            t?.click();
            return true;
        })()`);
        await waitFor(send, `(() => { const m = document.querySelector('${PORTAL_MENU}'); return !!m && m.offsetParent !== null && m.querySelectorAll('.blai-native-select-item').length > 0; })()`, '模型下拉展开');
        const menuState = await evaluate(send, `(() => {
            const m = document.querySelector('${PORTAL_MENU}');
            const s = getComputedStyle(m);
            const item = m.querySelector('.blai-native-select-item');
            return {
                padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
                gap: s.gap,
                maxHeight: s.maxHeight,
                height: m.getBoundingClientRect().height,
                itemRadius: item ? getComputedStyle(item).borderRadius : '',
            };
        })()`);
        check(failures, '下拉菜单四方向内边距不小于 6px', menuState.padding.every((v) => parseFloat(v) >= 6), menuState.padding.join('/'));
        check(failures, '下拉菜单有统一限高', menuState.maxHeight !== 'none' && parseFloat(menuState.maxHeight) > 0, `${menuState.maxHeight}, height=${menuState.height.toFixed(1)}px`);
        check(failures, '下拉行使用小圆角', parseFloat(menuState.itemRadius) > 0, menuState.itemRadius);

        // 反证：把 portal 菜单 token 破坏后，同一组判定必须失败，然后恢复。
        const broken = await evaluate(send, `(() => {
            const m = document.querySelector('${PORTAL_MENU}');
            window.__auditMenuStyle = { padding: m.style.getPropertyValue('padding'), maxHeight: m.style.getPropertyValue('max-height') };
            m.style.setProperty('padding', '0', 'important');
            m.style.setProperty('max-height', 'none', 'important');
            const s = getComputedStyle(m);
            return { padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], maxHeight: s.maxHeight };
        })()`);
        check(failures, '反证：破坏下拉 token 后判定会失败', broken.padding.some((v) => parseFloat(v) < 6) || broken.maxHeight === 'none', `${broken.padding.join('/')}, ${broken.maxHeight}`);
        await evaluate(send, `(() => {
            const m = document.querySelector('${PORTAL_MENU}');
            const o = window.__auditMenuStyle || {};
            if (o.padding) m.style.setProperty('padding', o.padding, 'important'); else m.style.removeProperty('padding');
            if (o.maxHeight) m.style.setProperty('max-height', o.maxHeight, 'important'); else m.style.removeProperty('max-height');
            return true;
        })()`);

        const shot = await capture(send, 'verify-batch2.png', {
            expectOpen: [PORTAL_MENU],
            state: { padding: menuState.padding.join('/'), maxHeight: menuState.maxHeight, groups: groups.join('/') },
        });
        await evaluate(send, `(() => { const t = document.querySelector('.blai-ai-model-field .blai-native-select-trigger') || document.querySelector('.blai-native-select-trigger'); t?.click(); return true; })()`);

        // 4. 手动模型单项删除：列表和下拉同步减少。
        await evaluate(send, `(() => { document.getElementById('blai-ai-model-manage')?.click(); return true; })()`);
        await waitFor(send, `getComputedStyle(document.getElementById('blai-ai-model-manage-modal')).display !== 'none'`, '模型管理弹窗');
        const beforeRows = await evaluate(send, `Array.from(document.querySelectorAll('#blai-ai-model-manage-list .blai-ai-model-manage-row')).map(r => r.textContent.trim())`);
        check(failures, '管理弹窗列出全部手动模型', beforeRows.includes('audit-manual-1') && beforeRows.includes('audit-manual-2'), beforeRows.join('/'));
        await evaluate(send, `(() => {
            const row = Array.from(document.querySelectorAll('#blai-ai-model-manage-list .blai-ai-model-manage-row')).find(r => r.textContent.includes('audit-manual-1'));
            row?.querySelector('.blai-ai-model-manage-delete')?.click();
            return true;
        })()`);
        await waitFor(send, `!!document.querySelector('.blai-plugin-dialog .blai-danger-btn')`, '清除确认弹窗');
        await evaluate(send, `(() => { document.querySelector('.blai-plugin-dialog .blai-danger-btn')?.click(); return true; })()`);
        await waitFor(send, `!Array.from(document.querySelectorAll('#blai-ai-model-manage-list .blai-ai-model-manage-row')).some(r => r.textContent.includes('audit-manual-1'))`, '手动模型删除');
        const afterRows = await evaluate(send, `Array.from(document.querySelectorAll('#blai-ai-model-manage-list .blai-ai-model-manage-row')).map(r => r.textContent.trim())`);
        const afterOptions = await evaluate(send, `Array.from(document.querySelectorAll('#blai-ai-model option')).map(o => o.textContent)`);
        check(failures, '单个清除只移除选中的手动模型', afterRows.includes('audit-manual-2') && !afterRows.includes('audit-manual-1'), afterRows.join('/'));
        check(failures, '清除后模型下拉同步更新', afterOptions.includes('audit-manual-2') && !afterOptions.includes('audit-manual-1'), afterOptions.join('/'));
        await evaluate(send, `(() => { document.getElementById('blai-ai-model-manage-done')?.click(); return true; })()`);

        // 5. 图标字体：子规则模式选项与 toast 关闭按钮。
        const iconState = await evaluate(send, `(async () => {
            const sub = document.getElementById('blai-modal-sub-mode');
            const shell = sub?.closest('.blai-modal-shell');
            const old = shell?.style.display || '';
            if (shell) shell.style.display = 'flex';
            const wrap = sub?.closest('.blai-native-select-wrap');
            const trigger = wrap?.querySelector('.blai-native-select-trigger');
            trigger?.click();
            await new Promise(r => setTimeout(r, 120));
            const menu = document.querySelector('${PORTAL_MENU}');
            const menuIcons = Array.from(menu?.querySelectorAll('i[class*="fa-"]') || []).map(i => i.className);
            trigger?.click();
            if (shell) shell.style.display = old;
            const optionIcons = Array.from(document.querySelectorAll('option[data-blai-icon]')).map(o => o.getAttribute('data-blai-icon'));
            let toastIcon = '';
            try {
                const mod = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/aiRewrite/runtime/runtime-00-ui.js');
                mod.notifyAiRewriteStatus('info', '图标验证', 'Font Awesome 图标', { closeButton: true });
                await new Promise(r => setTimeout(r, 80));
                toastIcon = document.querySelector('#blai-ai-toast-container .toast-close-button i')?.className || '';
                document.querySelectorAll('#blai-ai-toast-container .blai-ai-rewrite-toast').forEach(n => n.remove());
            } catch (e) {
                toastIcon = 'ERROR: ' + String(e);
            }
            return { optionIcons, menuIcons, toastIcon };
        })()`);
        check(failures, '子规则模式选项声明 FA 图标', iconState.optionIcons.length === 3, iconState.optionIcons.join('/'));
        check(failures, '子规则模式菜单渲染 FA 图标', iconState.menuIcons.some((c) => c.includes('fa-puzzle-piece')), iconState.menuIcons.join(' / '));
        check(failures, 'toast 关闭按钮使用 FA xmark', iconState.toastIcon.includes('fa-xmark'), iconState.toastIcon);

        console.log(`\n截图：${shot}`);
    } finally {
        // 无论断言成败都恢复 AI 设置与 TavernHelper，避免污染后续审计。
        await restoreState(send, aiSnapshot);
        let restored = await snapshotState(send, AI_STATE_SELECTORS);
        if (JSON.stringify(restored) !== JSON.stringify(aiSnapshot)) {
            await evaluate(send, `(() => {
                const o = ${JSON.stringify(aiSnapshot)};
                const enabled = document.getElementById('blai-ai-enabled');
                const base = document.getElementById('blai-ai-base-url');
                const key = document.getElementById('blai-ai-api-key');
                const wantEnabled = o['#blai-ai-enabled']?.checked === true;
                if (enabled && enabled.checked !== wantEnabled) enabled.click();
                if (base) $(base).val(o['#blai-ai-base-url']?.value || '').trigger('input').trigger('change');
                if (key) $(key).val(o['#blai-ai-api-key']?.value || '').trigger('input').trigger('change');
                return true;
            })()`);
            await sleep(200);
            restored = await snapshotState(send, AI_STATE_SELECTORS);
        }
        harnessCheck(failures, '审计后 AI 表单已恢复', JSON.stringify(restored) === JSON.stringify(aiSnapshot), `${JSON.stringify(restored)} / ${JSON.stringify(aiSnapshot)}`);
        await restoreAiSettings(send, aiBaseline);
        const actualAi = await snapshotAiSettings(send);
        harnessCheck(failures, '审计后 AI 设置对象已恢复', JSON.stringify(actualAi) === JSON.stringify(aiBaseline), `${JSON.stringify(actualAi)} / ${JSON.stringify(aiBaseline)}`);
        await evaluate(send, `(() => {
            if (window.__auditHadTavernHelper) window.TavernHelper = window.__auditOldTavernHelper;
            else delete window.TavernHelper;
            return true;
        })()`);
        const globalsRestored = await evaluate(send, `Object.prototype.hasOwnProperty.call(window, 'TavernHelper') === !!window.__auditHadTavernHelper`);
        harnessCheck(failures, '审计后 TavernHelper 已恢复', globalsRestored === true);
        await sleep(200);
        await send('Emulation.clearDeviceMetricsOverride');
    }

    console.log(JSON.stringify({ failures }, null, 2));
    ws.close();
    if (failures.length) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
