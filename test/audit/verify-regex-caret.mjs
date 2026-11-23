#!/usr/bin/env node
/**
 * 子规则「查找内容」正则框：高亮彩色字与输入光标的对齐回归测试。
 *
 * 守的是用户感受得到的行为：开启代码高亮后，光标必须停在它前面那个字的右侧，
 * 不能叠进字里。实现是「透明 textarea（真实光标）+ 彩色字覆盖层」两层叠加，
 * 只要两层的 font-size / font-weight / line-height / padding 有一项不同，
 * 光标（textarea 画）与字（覆盖层画）就会错位，且随加粗符号越靠前越明显。
 *
 * 真实踩过的坑：覆盖层的 6 类 token 用 bold(600)，textarea 是 normal(400)，
 * 中文全角字宽变化小看着正常，光标前一旦有 \A、(?<=、[]、? 等西文符号就叠字。
 * 本测试量「光标 x 与前一字符右边缘 x」的偏差 delta，并做双向反证：
 *   - 修复态：delta 必须接近 0（|delta| <= 2px）
 *   - 注入 bold：delta 必须明显变负（叠字复现），否则说明测试没守住行为
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-regex-caret.mjs
 * 失败退出 1，异常退出 2。只读页面状态，不改任何源文件（注入的 bold 用完即撤）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.CDP_PORT ?? '9224';
const TOL = 2; // px：光标 x 与前一字符右边缘的允许偏差

async function connect() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:8000'))
        || list.find((t) => t.type === 'page');
    if (!page) throw new Error('没有可用的 page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    return { ws, send };
}

async function evaluate(send, expression) {
    const r = await send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
        throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    }
    return r.result?.value;
}

// 在页面里装一个测量函数：量「光标 x - 前一字符右边缘 x」。
// textarea 没有 caret 坐标 API，用一个同字体的镜像 div 复刻到光标的文本来量光标 x。
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
    let node, acc = 0, tspan = null, off = 0;
    while (node = walker.nextNode()) {
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '\\u00a0') continue;     // 空行的 &nbsp; 不占正文字符位
        if (acc === pos - 1) { tspan = node.parentElement; off = i; break; }
        acc++;
      }
      if (tspan) break;
    }
    let charRight = null;
    if (tspan) {
      const r = document.createRange();
      r.setStart(tspan.firstChild, off); r.setEnd(tspan.firstChild, off + 1);
      charRight = r.getBoundingClientRect().right - hl.getBoundingClientRect().left;
    }
    const csHl = getComputedStyle(hl);
    return {
      delta: charRight == null ? null : +(caretX - charRight).toFixed(1),
      weightTa: cs.fontWeight, weightHl: csHl.fontWeight,
      lhTa: cs.lineHeight, lhHl: csHl.lineHeight,
      sizeTa: cs.fontSize, sizeHl: csHl.fontSize,
    };
  };
  return true;
})()`;

// 光标前有大量西文正则符号（曾经叠字的场景），中文前缀 + 括号/转义/量词混合。
// 注意标记必须选在「前面确有加粗 token」的位置：中文全角字 bold 与 normal 同宽，
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

async function main() {
    const { ws, send } = await connect();
    // 页面就绪 + 弹窗可用；弹窗由测量函数就地显示（若尚未打开）
    await evaluate(send, INSTALL);
    await evaluate(send, `(() => {
        const m = document.getElementById('blai-subrule-edit-modal');
        if (m) { m.style.display = 'flex'; m.removeAttribute('aria-hidden'); }
        const sel = document.getElementById('blai-modal-sub-mode');
        if (sel) { sel.value = 'regex'; jQuery(sel).trigger('change'); }
        return true;
    })()`);

    let failed = 0;
    for (const c of CASES) {
        for (const mark of c.marks) {
            const pos = c.val.indexOf(mark) + mark.length;
            if (pos < mark.length) continue; // 没找到标记，跳过
            const fixed = await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, false)`);
            const bold = await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, true)`);
            const restored = await evaluate(send, `window.__caretMeasure(${JSON.stringify(c.val)}, ${pos}, false)`);

            const metricMatch = fixed.weightTa === fixed.weightHl
                && fixed.lhTa === fixed.lhHl && fixed.sizeTa === fixed.sizeHl;
            const aligned = fixed.delta != null && Math.abs(fixed.delta) <= TOL;
            const counterProof = bold.delta != null && fixed.delta - bold.delta >= 1.5;
            const ok = metricMatch && aligned && counterProof
                && restored.delta != null && Math.abs(restored.delta) <= TOL;

            console.log(`\n[${c.label}] 光标在『${mark}』后 (pos=${pos})`);
            console.log(`  两层度量 textarea/highlight: weight ${fixed.weightTa}/${fixed.weightHl}, lh ${fixed.lhTa}/${fixed.lhHl}, size ${fixed.sizeTa}/${fixed.sizeHl}`);
            console.log(`  delta 修复=${fixed.delta}px  注入bold=${bold.delta}px  还原=${restored.delta}px`);
            if (ok) {
                console.log('  ✓ 光标贴字右侧；注入 bold 后叠字复现，还原后恢复（反证成立）');
            } else {
                failed++;
                if (!metricMatch) console.log('  ✗ 两层字形度量不一致');
                if (!aligned) console.log(`  ✗ 修复态光标未对齐 delta=${fixed.delta}px（阈值 ±${TOL}）`);
                if (!counterProof) console.log('  ✗ 反证失效：注入 bold 未让偏差变大，测试没守住行为');
            }
        }
    }
    // 清理：撤掉注入样式并恢复弹窗
    await evaluate(send, `(() => { document.getElementById('verify-bold')?.remove(); return true; })()`);
    ws.close();
    if (failed) {
        console.error(`\n验证失败：${failed} 处未通过`);
        process.exit(1);
    }
    console.log('\n全部通过：光标在所有场景贴字右侧，且反证证明测试确实守住了叠字 bug。');
}

main().catch((e) => {
    console.error('验证异常:', e.message);
    process.exit(2);
});
