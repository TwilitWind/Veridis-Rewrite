/**
 * 负责规则的用户操作、规则设置变更，以及它们的设置保存边界。
 * 规则解析/正则语义仍留在 model.js / regex.js。
 */

import { bindRuleSortEvents } from './events/events-02-sort.js';
import { bindRuleSearchEvents } from './events/events-03-search.js';
import { bindRuleBatchEvents } from './events/events-04-batch.js';
import { bindRuleCardEvents } from './events/events-05-card.js';
import { bindRuleListEvents } from './events/events-06-list.js';
import { bindRuleSubruleEditorEvents } from './events/events-07-subrule.js';
import { bindRuleModalActionEvents } from './events/events-08-modal.js';

// 聚合入口：实现已按 handler 分组拆分到 ./events/ 下的分块文件，注册顺序与拆分前逐条一致。

export function bindRuleEvents() {
    bindRuleSortEvents();
    bindRuleSearchEvents();
    bindRuleBatchEvents();
    bindRuleCardEvents();
    bindRuleListEvents();
    bindRuleSubruleEditorEvents();
    bindRuleModalActionEvents();
}
