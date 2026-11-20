/** 规则事件：sort。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { renderTagsPreserveBatchSelection } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty } from '.././state.js';

export function bindRuleSortEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();

    $(document).off('click', '#blai-rule-sort-toggle').on('click', '#blai-rule-sort-toggle', function(e) {
        e.preventDefault();
        const rules = extension_settings[extensionName].rules || [];
        rules.reverse();
        markRulesDataDirty();
        saveSettingsDebounced();
        renderTagsPreserveBatchSelection();
    });
}
