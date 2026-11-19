/**
 * 负责按需的差异弹窗渲染、操作，以及现有 DOM 绑定。
 */
import { createDiffEventsCore } from './events/events-00-core.js';
import { bindDiffEventHandlers } from './events/events-01-bindings.js';

export { recleanseDiffMessageAtIndex } from './events/events-00-core.js';

export function bindDiffEvents() {
    bindDiffEventHandlers(createDiffEventsCore());
}
