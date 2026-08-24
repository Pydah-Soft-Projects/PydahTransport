let deferredPrompt = null;
const listeners = new Set();
let captureCount = 0;

const onBeforeInstall = (event) => {
    if (captureCount <= 0) return;
    event.preventDefault();
    deferredPrompt = event;
    listeners.forEach((listener) => listener(event));
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
    });
}

export const getDeferredInstallPrompt = () => deferredPrompt;

export const clearDeferredInstallPrompt = () => {
    deferredPrompt = null;
};

export const subscribeInstallPrompt = (listener) => {
    if (deferredPrompt) listener(deferredPrompt);
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** Only call preventDefault while the install banner is mounted (home / login). */
export const startInstallCapture = () => {
    captureCount += 1;
    return () => {
        captureCount = Math.max(0, captureCount - 1);
    };
};
