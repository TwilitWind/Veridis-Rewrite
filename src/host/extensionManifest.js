// 负责基于能力的扩展清单位读取，用于反馈元信息。
import { extensionsPathMarker } from './extensionIdentity.js';
export async function readExtensionManifest(externalId, getExtensionManifest) {
    if (typeof getExtensionManifest === 'function') {
        return getExtensionManifest(externalId);
    }

    try {
        const response = await fetch(`${extensionsPathMarker}${externalId}/manifest.json`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        throw new Error(`Failed to read extension manifest for ${externalId} from the legacy SillyTavern path.`, { cause: error });
    }
}
