const ripgrepTargetPlatforms = new Map([
    ['win32-x64', Object.freeze({ os: 'win32', arch: 'x64' })],
    ['win32-arm64', Object.freeze({ os: 'win32', arch: 'arm64' })],
    ['linux-x64', Object.freeze({ os: 'linux', arch: 'x64' })],
    ['linux-arm64', Object.freeze({ os: 'linux', arch: 'arm64' })],
    ['linux-armhf', Object.freeze({ os: 'linux', arch: 'arm' })],
    ['darwin-x64', Object.freeze({ os: 'darwin', arch: 'x64' })],
    ['darwin-arm64', Object.freeze({ os: 'darwin', arch: 'arm64' })],
    ['alpine-x64', Object.freeze({ os: 'linux', arch: 'x64' })],
    ['alpine-arm64', Object.freeze({ os: 'linux', arch: 'arm64' })],
    ['web', undefined]
]);

function platformDirectory(platform) {
    return `${platform.os}-${platform.arch}`;
}

function executableName(platform) {
    return platform.os === 'win32' ? 'rg.exe' : 'rg';
}

function uniqueNativePlatforms(targets) {
    const byDirectory = new Map();

    targets.forEach((target) => {
        if (!ripgrepTargetPlatforms.has(target)) {
            throw new Error(`Unsupported ripgrep target "${target}".`);
        }

        const platform = ripgrepTargetPlatforms.get(target);
        if (platform !== undefined) {
            byDirectory.set(platformDirectory(platform), platform);
        }
    });
    return Array.from(byDirectory.values());
}

export {
    executableName,
    platformDirectory,
    ripgrepTargetPlatforms,
    uniqueNativePlatforms
};
