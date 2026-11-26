#!/usr/bin/env node
/**
 * 魔法棒菜单里「词汇映射」与酒馆原生条目的缩进回归。
 *
 * 根因：原生条目是 .list-group-item.flex-container.flexGap5，图标是
 * .extensionsMenuExtensionButton，窄菜单里 .flex-container 让文字换行；
 * 插件条目曾经没有这些类且写了 white-space:nowrap，窄屏下文字不换行，
 * 相对换行的原生条目缩进就偏右。本测试在 9224 端口浏览器量文字 x，双端 + 窄菜单反证。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-wand-menu.mjs
 * 失败退出码 1，打印逐项期望/实际。
 */
import { connect, evaluate, waitFor, ensurePageFresh, check, assertManagedFilesSynced, IPHONE_UA } from './_harness.mjs';

const failures = [];

const MEASURE = `(async () => {
    const menu = document.getElementById('extensionsMenu');
    const btn = document.getElementById('extensionsMenuButton');
    const native = document.getElementById('manageAttachments');
    const attach = document.getElementById('attachFile');
    const plugin = document.getElementById('blai-wand-btn');
    if (!menu || !btn || !native || !attach || !plugin) return { missing: true, menu: !!menu, btn: !!btn, native: !!native, attach: !!attach, plugin: !!plugin };
    if (getComputedStyle(menu).display === 'none') btn.click();
    await new Promise(r => setTimeout(r, 600));
    const read = (el) => {
        const b = el.querySelector('span').getBoundingClientRect();
        return { x: +b.x.toFixed(2), y: +b.y.toFixed(2) };
    };
    const snap = async () => {
        // 窄菜单测量或样式注入可能让菜单折叠；每次采样前确保可见，避免读到全 0 的假对齐。
        if (getComputedStyle(menu).display === 'none') {
            btn.click();
            await new Promise(r => setTimeout(r, 400));
        }
        if (getComputedStyle(menu).display === 'none') return { hidden: true };
        return { native: read(native), attach: read(attach), plugin: read(plugin) };
    };
    const natural = await snap();
    menu.style.width = '103px';
    await new Promise(r => setTimeout(r, 200));
    const narrow = await snap();
    menu.style.width = '';
    // 真机上酒馆会把原生 gap 从 10px 动态改成 5px；插件必须跟随而不能写死列距。
    const probe = document.createElement('style');
    probe.textContent = '.flexGap5 { gap: 5px !important; }';
    document.head.appendChild(probe);
    await new Promise(r => setTimeout(r, 200));
    const gap5 = await snap();
    probe.remove();
    return {
        natural, narrow, gap5,
        cls: String(plugin.className),
        iconCls: String(plugin.querySelector('.extensionsMenuExtensionButton')?.className || ''),
        wrap: getComputedStyle(plugin).flexWrap,
        whiteSpace: getComputedStyle(plugin.querySelector('span')).whiteSpace,
        pluginGap: getComputedStyle(plugin).columnGap,
    };
})()`;

const synced = assertManagedFilesSynced();
console.log(`受管文件已同步：${synced}/${synced}`);
const { ws, send } = await connect();

try {
    for (const sc of [
        { name: '桌面', width: 1280, height: 720, mobile: false },
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
        await ensurePageFresh(send, `!!document.getElementById('blai-wand-btn') && !!document.getElementById('extensionsMenu') && !!document.getElementById('extensionsMenuButton') && !!document.getElementById('manageAttachments')`, `${sc.name}: 页面就绪`, 120);
        await waitFor(send, `(() => { const m = document.getElementById('extensionsMenu'), b = document.getElementById('extensionsMenuButton'); if (!m || !b) return false; if (getComputedStyle(m).display === 'none') b.click(); return getComputedStyle(m).display !== 'none'; })()`, `${sc.name}: 菜单打开`, 20, 500);
        const r = await evaluate(send, MEASURE);
        if (!r || r.missing) {
            check(failures, `${sc.name}: 菜单条目存在`, false, JSON.stringify(r));
            continue;
        }
        check(failures, `${sc.name}: 复用原生条目类`, r.cls.includes('list-group-item') && r.cls.includes('flex-container') && r.cls.includes('flexGap5'), r.cls);
        check(failures, `${sc.name}: 复用原生图标类`, r.iconCls.includes('extensionsMenuExtensionButton'), r.iconCls);
        check(failures, `${sc.name}: 允许窄菜单换行`, r.wrap === 'wrap' && r.whiteSpace === 'normal', `wrap=${r.wrap}, white-space=${r.whiteSpace}`);
        const aligned = (snap, label) => check(failures, `${sc.name}: ${label}三行文字对齐`,
            !snap.hidden && snap.native.x > 0 &&
            Math.abs(snap.native.x - snap.plugin.x) < 0.5 && Math.abs(snap.attach.x - snap.plugin.x) < 0.5,
            `数据库 x=${snap.native.x}, 附件 x=${snap.attach.x}, 词汇映射 x=${snap.plugin.x}`);
        aligned(r.natural, '常规宽度');
        aligned(r.narrow, '窄菜单');
        aligned(r.gap5, '原生 gap=5px');
    }
} finally {
    try { await send('Emulation.clearDeviceMetricsOverride'); } catch {}
    try { await send('Network.setUserAgentOverride', { userAgent: '' }); } catch {}
    ws.close();
}

if (failures.length) {
    console.error(`失败 ${failures.length} 项：\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('魔法棒菜单缩进回归：12/12 通过');
