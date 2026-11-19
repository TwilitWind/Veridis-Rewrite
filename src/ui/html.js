// 用于渲染 Veridis 标记的纯 HTML 文本转义。没有 DOM 改写或功能状态。
export function safeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
