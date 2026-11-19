const extensionsPathMarker = '/scripts/extensions/';

/**
 * 从加载入口模块的 URL 推导该扩展的 SillyTavern 标识，
 * 因此本地连接点（junction）可以使用任意文件夹名。
 */
export function resolveExtensionIdentity(moduleUrl) {
    const pathname = new URL(moduleUrl).pathname;
    const markerIndex = pathname.lastIndexOf(extensionsPathMarker);
    if (markerIndex < 0) {
        throw new Error(`Unable to resolve the SillyTavern extension path from ${moduleUrl}.`);
    }

    const scriptPath = decodeURIComponent(pathname.slice(markerIndex + extensionsPathMarker.length));
    const pathSegments = scriptPath.split('/').filter(Boolean);
    pathSegments.pop(); // index.js
    if (!pathSegments.length) {
        throw new Error(`Unable to resolve the SillyTavern extension identifier from ${moduleUrl}.`);
    }

    const externalId = pathSegments.join('/');
    return {
        externalId,
        folderName: pathSegments.at(-1),
        templateDirectory: `${externalId}/templates`,
    };
}
