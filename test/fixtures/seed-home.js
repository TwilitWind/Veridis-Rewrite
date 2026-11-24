// 酒馆数据为空时用：造一条最小规则与存档预设，避免截图落在“0 规则组”的空首页。
// 用法：SEED_JS=@test/fixtures/seed-home.js（st-shot / st-mobile 会在出图前执行）。
// 只补缺失数据，不覆盖已有规则；写完用 saveSettings() 落盘，并刷新规则卡与预设工具栏。
(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/src';
    const app = await import(`${base}/host/appContext.js`);
    const st = await import('/script.js');
    const settings = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite;
    if (!settings) throw new Error('Veridis-Rewrite 设置对象不存在，无法造测试数据');

    const presetName = '__cdp_fixture__';
    if (!Array.isArray(settings.rules) || settings.rules.length === 0) {
        settings.rules = [{
            id: 'cdp-fixture-rule',
            name: '验证用规则集',
            enabled: true,
            subRules: [{
                targets: ['测试文本'],
                replacements: ['示例文本'],
                mode: 'text',
                rewriteMode: 'program',
                enabled: true,
            }],
        }];
    }
    if (!settings.presets || typeof settings.presets !== 'object') settings.presets = {};
    if (!settings.presets[presetName]) {
        settings.presets[presetName] = { rules: JSON.parse(JSON.stringify(settings.rules)) };
    }
    if (!settings.activePreset) settings.activePreset = presetName;

    await st.saveSettings();

    const rulesState = await import(`${base}/rules/state.js`);
    rulesState.markRulesUiDirty(true);
    const rulesView = await import(`${base}/rules/view/view-01-modal.js`);
    rulesView.renderTags?.();

    const presetState = await import(`${base}/presets/state.js`);
    presetState.markPresetsUiDirty(true);
    const presetView = await import(`${base}/presets/view.js`);
    presetView.updateToolbarUI?.();

    return {
        rules: settings.rules.length,
        activePreset: settings.activePreset,
        cards: document.querySelectorAll('#blai-home-rule-grid > .blai-home-card').length,
    };
})()
