/** 负责为现有显示刷新路径检测 BaiBai Toolkit 是否存在，不涉及它的任务或保存状态。 */
import { getGlobalObject } from '../host/context.js';

export function isBaiBaiToolkitInstalled() {
    const root = getGlobalObject();
    return Boolean(
        root.__baiBaiToolkitExtensionInstalled
        || root.__baiBaiToolkitSaveGenerateFetchPatched
        || root.__baiBaiToolkitSaveRequestGzipFetchPatched,
    );
}
