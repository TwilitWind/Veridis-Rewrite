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
    const plugin = document.getElementById('blai-wand-btn');
    if (!menu || !btn || !native || !plugin) return { missing: true, menu: !!menu, btn: !!btn, native: !!native, plugin: !!plugin };
    if (getComputedStyle(menu).display === 'none') btn.click();
    await new Promise(r => setTimeout(r, 600));
    const read = (el) => {
        const b = el.querySelector('span').getBoundingClientRect();
        return { x: +b.x.toFixed(2), y: +b.y.toFixed(2) };
    };
    const natural = { native: read(native), plugin: read(plugin) };
    menu.style.width = '103px';
    await new Promise(r => setTimeout(r, 200));
    const narrow = { native: read(native), plugin: read(plugin) };
    menu.style.width = '';
    return {
        natural, narrow,
        cls: String(plugin.className),
        iconCls: String(plugin.querySelector('.extensionsMenuExtensionButton')?.className || ''),
        wrap: getComputedStyle(plugin).flexWrap,
        whiteSpace: getComputedStyle(plugin.querySelector('span')).whiteSpace,
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
        check(failures, `${sc.name}: 常规宽度文字对齐`, Math.abs(r.natural.native.x - r.natural.plugin.x) < 0.5,
            `原生 x=${r.natural.native.x}, 插件 x=${r.natural.plugin.x}`);
        check(failures, `${sc.name}: 窄菜单文字对齐`, Math.abs(r.narrow.native.x - r.narrow.plugin.x) < 0.5,
            `原生 x=${r.narrow.native.x}, 插件 x=${r.narrow.plugin.x}`);
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
console.log('魔法棒菜单缩进回归：10/10 通过');
