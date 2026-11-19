// 只负责临时的预设 UI/应用状态；持久化的预设与绑定仍在扩展设置中。
export const presetsRuntimeState = {
    presetsUiDirty: true,
    lastPresetBindingSignature: '',
    importPresetDraft: null,
};

export function markPresetsUiDirty(dirty = true) {
    presetsRuntimeState.presetsUiDirty = dirty;
}
