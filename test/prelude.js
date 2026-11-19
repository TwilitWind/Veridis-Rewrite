// 拼接到查询脚本之前：cat "$SKILL/scripts/prelude.js" dev/q.js > dev/run.js
// 全部写入 globalThis，重复求值不会报重复声明。
// 严禁定义名为 $ 或 $$ 的全局函数：SillyTavern 全站用 jQuery 的 window.$，
// 覆盖后 doNavbarIconClick 里的 $(this) 会变成 document.querySelector(元素)，
// 抛 SyntaxError 并让抽屉点击彻底失效。选择器一律用 qs / qsa。
Object.assign(globalThis, {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    qs: (sel, root = document) => root.querySelector(sel),
    qsa: (sel, root = document) => [...root.querySelectorAll(sel)],
    visible: (el) => !!el && getComputedStyle(el).display !== 'none',
    box: (el) => (el ? el.getBoundingClientRect() : null),
    mid: (el) => { const r = el && el.getBoundingClientRect(); return r ? r.top + r.height / 2 : null; },
    cx: (el) => { const r = el && el.getBoundingClientRect(); return r ? r.left + r.width / 2 : null; },
    dY: (a, b) => (a && b ? +(mid(a) - mid(b)).toFixed(2) : null),
    dX: (a, b) => (a && b ? +(cx(a) - cx(b)).toFixed(2) : null),
    // 断言 window.$ 仍是 jQuery；被覆盖时立即报错，避免静默失效。
    assertJQuery: () => {
        if (typeof window.$ !== 'function' || !window.$.fn) throw new Error('window.$ is not jQuery: global $ was shadowed');
        return true;
    },
});

// 打开扩展设置抽屉，已展开则不动作。返回是否可见。
globalThis.openDrawer = async (waitMs = 1200) => {
    const toggle = document.querySelector('#extensions-settings-button .drawer-toggle');
    const content = document.querySelector('#rm_extensions_block');
    if (toggle && content && getComputedStyle(content).display === 'none') toggle.click();
    await globalThis.wait(waitMs);
    return !!content && getComputedStyle(content).display !== 'none';
};

// 在元素中心派发 mousedown/mouseup/click，绕过 ST 抽屉对外部 mousedown 的收起判定。
globalThis.clickAt = (el) => {
    const r = el && el.getBoundingClientRect();
    if (!r) return false;
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const target = document.elementFromPoint(o.clientX, o.clientY) ?? el;
    for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, o));
    return true;
};
