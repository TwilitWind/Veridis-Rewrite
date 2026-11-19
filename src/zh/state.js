// 负责内存中的中文字典包状态与当前安装取消标记；持久化的字典元数据仍在别处。
export const zhRuntimeState = {
    zhDictionaryInstallCancelRequested: false,
    zhVariantDictionary: null,
};
