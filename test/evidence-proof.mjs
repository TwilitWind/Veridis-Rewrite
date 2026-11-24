// 截图/审计证据的“内容非空”闸门。
// 背景：只校验弹窗/面板可见还不够，酒馆数据为空时也会截出“打开但空白”的图并当证据。
// 用法：EXPECT_CONTENT='<rowSelector>[:<min>]'，例如
//   EXPECT_CONTENT='#blai-home-rule-grid > .blai-home-card:1'
// 语义：选择器命中的元素里，可见且非 0 尺寸的数量必须 >= min（默认 1）。

export function parseExpectContent(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const raw = String(value).trim();
    const match = raw.match(/^(.*):(\d+)$/);
    const selector = (match ? match[1] : raw).trim();
    const min = match ? Number(match[2]) : 1;
    if (!selector) throw new Error('EXPECT_CONTENT 需要选择器，格式：<rowSelector>[:<min>]');
    if (!Number.isInteger(min) || min < 1) throw new Error(`EXPECT_CONTENT 的最小数量必须是正整数，收到 ${match?.[2]}`);
    return { selector, min };
}

export function contentProbeExpression(spec) {
    const { selector, min } = spec;
    return `(() => {
        const selector = ${JSON.stringify(selector)};
        const min = ${JSON.stringify(min)};
        const nodes = Array.from(document.querySelectorAll(selector));
        const targets = nodes.map((el) => {
            const st = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            const visible = st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
            if (!visible) return { ok: false, reason: 'hidden', display: st.display, visibility: st.visibility, opacity: st.opacity };
            if (b.width <= 1 || b.height <= 1) return { ok: false, reason: 'zero-size', w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
            return { ok: true, w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
        });
        return { selector, min, total: nodes.length, visible: targets.filter((t) => t.ok).length, targets: targets.slice(0, 10) };
    })()`;
}

export function contentFailureMessage(spec, probe) {
    if (!spec) return null;
    if (!probe) return `内容区证据缺失：${spec.selector}`;
    if (probe.visible >= spec.min) return null;
    const bad = (probe.targets || []).filter((t) => !t.ok);
    const reason = bad.length
        ? `（${bad.map((t) => t.reason).join(', ')}）`
        : '';
    return `内容区为空：${spec.selector} 可见 ${probe.visible} 行，要求至少 ${spec.min} 行${reason}；当前酒馆数据为空时需先跑 SEED_JS 造样例数据，不要把空面板当证据`;
}

export function assertContentEvidence(spec, probe) {
    const message = contentFailureMessage(spec, probe);
    if (message) throw new Error(message);
    return true;
}
