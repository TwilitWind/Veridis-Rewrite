#!/usr/bin/env node
/**
 * 子规则「查找内容」正则框：高亮彩色字与输入光标的对齐回归测试。
 *
 * 守的是用户感受得到的行为：开启代码高亮后，光标必须停在它前面那个字的右侧，
 * 不能叠进字里。实现是「透明 textarea（真实光标）+ 彩色字覆盖层」两层叠加，
 * 只要两层的 font-size / font-weight / line-height / padding 有一项不同，
 * 光标（textarea 画）与字（覆盖层画）就会错位，且随加粗符号越靠前越明显。
 *
 * 真实踩过的坑：覆盖层的 6 类 token 用 bold(600)，textarea 是 normal(400)。
 * 本测试量「光标 x 与前一字符右边缘 x」的偏差 delta，并做双向反证：
 *   - 修复态：delta 必须接近 0（|delta| <= 2px）
 *   - 注入 bold：delta 必须明显变负（叠字复现），否则说明测试没守住行为
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-regex-caret.mjs
 * 失败退出 1，异常退出 2。只改页面内存，结束恢复设置与弹窗，不写用户聊天数据。
 */
import { connect, evaluate, waitFor, ensurePageFresh, check, capture } from './_harness.mjs';
import { forceSaveSettings } from './_diff-fixture.mjs';

const TOL = 2; // px：光标 x 与前一字符右边缘的允许偏差

// textarea 没有 caret 坐标 API，用同字体的镜像 div 复刻到光标的文本来量光标 x。
// 命中字符时保留「那个文本节点」本身，避免多 span 嵌套下按 span.firstChild 取偏移错位。
const INSTALL = `(() => {
  window.__caretMeasure = (val, pos, injectBold) => {
    const ta = document.getElementById('blai-modal-sub-target');
    const hl = document.getElementById('blai-regex-target-highlight');
    if (!ta || !hl) throw new Error('正则框元素不存在（弹窗未打开？）');
    let st = document.getElementById('verify-bold');
    if (injectBold && !st) {
      st = document.createElement('style'); st.id = 'verify-bold';
      st.textContent = '.blai-regex-highlight .blai-regex-tok{font-weight:600 !important}';
      document.head.appendChild(st);
    } else if (!injectBold && st) { st.remove(); }
    ta.value = val;
    jQuery(ta).trigger('input');           // 触发高亮重绘（含括号配对）
    jQuery(ta).trigger('click');           // 触发配对高亮同步
    ta.focus(); ta.setSelectionRange(pos, pos);

    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;'
      + 'word-break:break-word;font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize
      + ';font-weight:' + cs.fontWeight + ';line-height:' + cs.lineHeight
      + ';letter-spacing:' + cs.letterSpacing + ';word-spacing:' + cs.wordSpacing
      + ';width:' + ta.clientWidth + 'px;padding:' + cs.padding + ';box-sizing:border-box;';
    mirror.textContent = val.slice(0, pos);
    const mark = document.createElement('span'); mark.textContent = '\\u200b';
    mirror.appendChild(mark); document.body.appendChild(mark.parentElement);
    const caretX = mark.getBoundingClientRect().left - mirror.getBoundingClientRect().left;
    mirror.remove();

    const walker = document.createTreeWalker(hl, NodeFilter.SHOW_TEXT);
    let node, acc = 0, targetNode = null, off = 0;
    while (node = walker.nextNode()) {
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '\\u00a0') continue;     // 空行的 &nbsp; 不占正文字符位
        if (acc === pos - 1) { targetNode = node; off = i; break; }
        acc++;
      }
      if (targetNode) break;
    }
    let charRight = null;
    if (targetNode) {
      const r = document.createRange();
      r.setStart(targetNode, off); r.setEnd(targetNode, off + 1);
      charRight = r.getBoundingClientRect().right - hl.getBoundingClientRect().left;
    }
    const csHl = getComputedStyle(hl);
    return {
      delta: charRight == null ? null : +(caretX - charRight).toFixed(1),
      weightTa: cs.fontWeight, weightHl: csHl.fontWeight,
      lhTa: cs.lineHeight, lhHl: csHl.lineHeight,
      sizeTa: cs.fontSize, sizeHl: csHl.fontSize,
      highlightChars: hl.textContent.replace(/\\u00a0/g, '').length,
    };
  };
  return true;
})()`;

// 光标前有大量西文正则符号（曾经叠字的场景），中文前缀 + 括号/转义/量词混合。
// 标记必须选在「前面确有加粗 token」的位置：中文全角字 bold 与 normal 同宽，
// 若光标前只有中文/字符组，原 bug 本就不发生，注入 bold 也不会产生偏差，反证会误报失败。
const CASES = [
    {
        label: '括号+转义混合',
        val: '一丝丝[:(不[挂词])[(?<=\\A [...,.]):这具 [这那一段][狗子?)]',
        marks: ['具', '子'],
    },
    {
        label: '环视+unicode 转义',
        val: '(?<=[这那是羽以用有来了和出起到过成为])[:(馄饨-狗子)]:[(某-某种绿道层声)]?[\\u4e00-\\u9fff]',
        marks: ['f', '子'],
    },
];

const SETUP = `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/src/';
    const app = await import(base + 'host/appContext.js');
    const view = await import(base + 'rules/view.js');
    const st = await import('/script.js');
    const settings = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite;
    const before = settings ? settings.regexHighlightEnabled : undefined;
    if (settings) settings.regexHighlightEnabled = true;
    await st.saveSettings();
    view.openSingleRuleModal(-1, { hideEditModal: true });
    const sel = document.getElementById('blai-modal-sub-mode');
    sel.value = 'regex';
    jQuery(sel).trigger('change');
    return { before: before === undefined ? null : before };
})()`;

const RESTORE = `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/src/';
    const app = await import(base + 'host/appContext.js');
    const st = await import('/script.js');
    const settings = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite;
    const saved = __SAVED__;
    if (settings && saved !== null) settings.regexHighlightEnabled = saved;
    await st.saveSettings();
    document.getElementById('verify-bold')?.remove();
    if (document.getElementById('blai-subrule-edit-modal')) {
        document.getElementById('blai-subrule-edit-modal').style.display = 'none';
    }
    return true;
})()`;

const failures = [];
const { ws, send } = await connect();
let savedHighlight = null;
try {
    await ensurePageFresh(send, `!!document.getElementById('blai-modal-sub-target') && !!document.getElementById('blai-regex-target-highlight')`, '插件就绪');
    const setup = await evaluate(send, SETUP);
    savedHighlight = setup.before;
    await evaluate(send, INSTALL);
    await waitFor(send, `getComputedStyle(document.getElementById('blai-subrule-edit-modal')).display !== 'none'`, '子规则弹窗打开', 40, 300);

    for (const c of CASES) {
        for (const mark of c.marks) {
            const pos = c.val.indexOf(mark) + mark.length;
            if (pos < mark.length) continue; // 没找到标记，跳过
            // 先触发一次真实高亮渲染，再取判定；避免覆盖层还是 hidden/空壳时量到 null。
            await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, false)`);
            await waitFor(send, `document.getElementById('blai-regex-target-highlight').textContent.replace(/\\u00a0/g, '').length > 0`, '语法高亮层已渲染', 30, 200);
            const fixed = await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, false)`);
            const bold = await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, true)`);
            const restored = await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, false)`);

            const metricMatch = fixed.weightTa === fixed.weightHl
                && fixed.lhTa === fixed.lhHl && fixed.sizeTa === fixed.sizeHl;
            const aligned = fixed.delta != null && Math.abs(fixed.delta) <= TOL;
            const counterProof = bold.delta != null && fixed.delta - bold.delta >= 1.5;
            const ok = metricMatch && aligned && counterProof
                && restored.delta != null && Math.abs(restored.delta) <= TOL;

            console.log(`[${c.label}] 光标在『${mark}』后 (pos=${pos})`);
            console.log(`  两层度量 textarea/highlight: weight ${fixed.weightTa}/${fixed.weightHl}, lh ${fixed.lhTa}/${fixed.lhHl}, size ${fixed.sizeTa}/${fixed.sizeHl}`);
            console.log(`  delta 修复=${fixed.delta}px  注入bold=${bold.delta}px  还原=${restored.delta}px`);
            check(failures, `${c.label}/${mark} 两层字形度量一致`, metricMatch,
                `weight ${fixed.weightTa}/${fixed.weightHl}, lh ${fixed.lhTa}/${fixed.lhHl}, size ${fixed.sizeTa}/${fixed.sizeHl}`);
            check(failures, `${c.label}/${mark} 光标贴字右侧`, aligned, `delta=${fixed.delta}px（阈值 ±${TOL}）`);
            check(failures, `${c.label}/${mark} 注入 bold 能复现叠字`, counterProof,
                `修复=${fixed.delta}px，注入=${bold.delta}px`);
            check(failures, `${c.label}/${mark} 撤销注入后恢复`, restored.delta != null && Math.abs(restored.delta) <= TOL,
                `还原=${restored.delta}px`);
        }
    }
    const shot = await capture(send, 'verify-regex-caret.png', { expectOpen: ['#blai-subrule-edit-modal'] });
    console.log(`截图 ${shot}`);
} finally {
    await evaluate(send, RESTORE.replace('__SAVED__', JSON.stringify(savedHighlight))).catch(() => {});
    await forceSaveSettings(send).catch(() => {});
    ws.close();
}

if (failures.length) {
    console.error(`\n验证失败：${failures.length} 处未通过\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('\n全部通过：光标贴字右侧，且反证证明测试确实守住了叠字 bug。');
