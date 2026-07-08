/**
 * Open a hidden iframe, write HTML, and trigger the browser print dialog.
 */
export function printHtmlDocument(html, title, onClose, options) {
    const deferPrintMs = options?.deferPrintMs ?? 300;
    if (typeof document === 'undefined') return;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;overflow:hidden;');
    iframe.setAttribute('title', title);
    document.body.appendChild(iframe);

    let done = false;
    let printTriggered = false;

    const cleanup = () => {
        if (done) return;
        done = true;
        if (iframe.parentNode) {
            iframe.remove();
        }
        onClose?.();
    };

    const triggerPrint = () => {
        if (printTriggered) return;
        printTriggered = true;
        const win = iframe.contentWindow;
        if (!win || !iframe.parentNode) {
            cleanup();
            return;
        }
        win.focus();
        win.print();
        win.onafterprint = cleanup;
    };

    iframe.onload = triggerPrint;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
        cleanup();
        return;
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Fallback if onload doesn't fire (e.g. cached images or fast loads)
    setTimeout(() => {
        if (!printTriggered) {
            triggerPrint();
        }
    }, deferPrintMs);
}
