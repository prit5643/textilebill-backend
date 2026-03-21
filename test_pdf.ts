import { PdfService } from './src/modules/invoice/pdf.service';

async function testPdf() {
    const srv = new PdfService();
    try {
        console.log("Generating PDF...");
        const buf = await srv.generateInvoicePdf({
            items: [], totalIgst: 0,
            account: { name: 'test' }, invoiceDate: new Date(),
        }, { name: 'Company' });
        console.log("PDF BUF SIZE:", buf.length);
    } catch (err) {
        console.error("FAILED PDF:", err);
    }
}
testPdf();
