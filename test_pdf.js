const { PdfService } = require('./src/modules/invoice/pdf.service');

async function test() {
    try {
        const srv = new PdfService();
        // mock invoice
        const mockInvoice = {
            items: [],
            account: {},
        };
        const buf = await srv.generateInvoicePdf(mockInvoice, {});
        console.log("PDF created! Size:", buf.length);
    } catch (err) {
        console.error("PDF Error:", err);
    }
}
test();
