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

export function exportHtmlAsExcel(html, filename) {
    if (typeof document === 'undefined') return;

    const FONT_FAMILY = 'Calibri, Arial, sans-serif';
    const FONT_SIZE   = '11pt';

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Strip every <style> block — replace with one uniform sheet
    doc.querySelectorAll('style').forEach((s) => s.remove());

    // Fix tables: remove fixed layout / width so Excel auto-sizes columns
    doc.querySelectorAll('table').forEach((table) => {
        table.style.tableLayout    = 'auto';
        table.style.width          = 'auto';
        table.style.borderCollapse = 'collapse';
        table.removeAttribute('width');
    });

    // Strip font-size, font-family, and width inline styles from every element
    // so nothing overrides the uniform stylesheet below
    doc.querySelectorAll('*').forEach((el) => {
        el.style.removeProperty('font-size');
        el.style.removeProperty('font-family');
        el.style.removeProperty('width');
        el.style.removeProperty('max-width');
        el.style.removeProperty('min-width');
        el.style.removeProperty('letter-spacing');
        el.style.removeProperty('text-transform');
    });

    // th / td specific fixes
    doc.querySelectorAll('th, td').forEach((cell) => {
        cell.style.border        = '1px solid #000';
        cell.style.padding       = '4px 8px';
        cell.style.whiteSpace    = 'normal';
        cell.style.wordWrap      = 'break-word';
        cell.style.verticalAlign = 'middle';
    });

    // Keep bold + grey background on header cells
    doc.querySelectorAll('th').forEach((th) => {
        th.style.background  = '#d9d9d9';
        th.style.fontWeight  = 'bold';
        th.style.textAlign   = th.style.textAlign || 'center';
    });

    // Single uniform stylesheet
    const sheet = doc.createElement('style');
    sheet.textContent = `
        * { font-family: ${FONT_FAMILY}; font-size: ${FONT_SIZE}; color: #000; }
        table { border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 4px 8px; vertical-align: middle; mso-number-format: "@"; }
        th { background: #d9d9d9; font-weight: bold; }
        .abstract-total-row td, .abstract-total-row th { font-weight: bold; border-top: 2px solid #000; }
    `;
    doc.head.appendChild(sheet);

    const excelHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Report</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/><x:FitToPage/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
${doc.head.innerHTML}
</head>
<body>${doc.body.innerHTML}</body>
</html>`;

    const blob = new Blob(['\uFEFF' + excelHtml], {
        type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.xls') ? filename : `${filename}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
