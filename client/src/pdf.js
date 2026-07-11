import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// Builds a one-page sales invoice as a jsPDF document. `order` is the full
// response returned by the sales-order create/get endpoints (items, totals,
// payment fields all already computed). Does not save/download anything -
// callers decide whether to preview it, download it, or both.
export function buildSalesBillPDF(order) {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text('Shop Management', 14, 18);
  doc.setFontSize(12);
  doc.text('Sales Invoice', 14, 26);

  doc.setFontSize(10);
  doc.text(`Order ID: ${order.id}`, 14, 38);
  doc.text(`Date: ${new Date(order.date).toLocaleString()}`, 14, 44);
  doc.text(`Customer: ${order.customerName}`, 14, 50);

  doc.text(`Payment Method: ${order.paymentMethod}`, 140, 38);
  doc.text(`Payment Status: ${order.paymentStatus}`, 140, 44);

  autoTable(doc, {
    startY: 58,
    head: [['Product', 'Qty', 'Unit Price', 'Discount %', 'Line Total']],
    body: order.items.map((it) => [
      it.name,
      String(it.qty),
      money(it.unitPrice),
      `${Number(it.discountPercent || 0)}%`,
      money(it.lineTotal),
    ]),
  });

  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.text(`Subtotal: ${money(order.subtotal)}`, 140, y);
  y += 6;
  doc.text(`Discount: -${money(order.discountTotal)}`, 140, y);
  y += 6;
  doc.text(`Tax (${order.taxPercent || 0}%): ${money(order.taxAmount)}`, 140, y);
  y += 10;
  doc.setFontSize(13);
  doc.text(`Total: ${money(order.total)}`, 140, y);

  if (Number(order.amountDue) > 0) {
    y += 10;
    doc.setFontSize(10);
    doc.text(`Amount Paid: ${money(order.amountPaid)}`, 140, y);
    y += 6;
    doc.text(`Amount Due: ${money(order.amountDue)}`, 140, y);
  }

  return doc;
}

// Object URLs (blob:) can be pointed at directly by an <iframe> for an
// in-browser preview. Caller is responsible for revoking it when done.
export function pdfPreviewUrl(doc) {
  return URL.createObjectURL(doc.output('blob'));
}

export function downloadPDF(doc, filename) {
  doc.save(filename);
}
