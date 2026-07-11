import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function buildNonGstBill(doc, order) {
  doc.setFontSize(18);
  doc.text('Shop Management', 14, 18);
  doc.setFontSize(12);
  doc.text('Bill of Supply', 14, 26);

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

function buildGstTaxInvoice(doc, order) {
  const seller = order.sellerSnapshot || {};

  doc.setFontSize(18);
  doc.text(seller.businessName || 'Shop Management', 14, 18);
  doc.setFontSize(12);
  doc.text('TAX INVOICE', 14, 26);

  doc.setFontSize(9);
  const sellerAddressLine = [seller.address, seller.city, seller.state].filter(Boolean).join(', ');
  doc.text(`${sellerAddressLine}${seller.pincode ? ' - ' + seller.pincode : ''}`, 14, 32);
  doc.text(`GSTIN: ${seller.gstin || ''}`, 14, 37);

  doc.setFontSize(10);
  doc.text(`Invoice No: ${order.id}`, 14, 47);
  doc.text(`Date: ${new Date(order.date).toLocaleString()}`, 14, 53);
  doc.text(`Bill To: ${order.customerName}`, 14, 59);
  doc.text(`Customer GSTIN: ${order.customerGSTIN || 'Unregistered (B2C)'}`, 14, 65);

  doc.text(`Place of Supply: ${order.placeOfSupply || ''}`, 140, 47);
  doc.text(`Reverse Charge: No`, 140, 53);
  doc.text(`Payment Method: ${order.paymentMethod}`, 140, 59);
  doc.text(`Payment Status: ${order.paymentStatus}`, 140, 65);

  const head = order.isIntraState
    ? [['HSN/SAC', 'Product', 'Qty', 'Rate', 'Taxable Val', 'GST%', 'CGST', 'SGST']]
    : [['HSN/SAC', 'Product', 'Qty', 'Rate', 'Taxable Val', 'GST%', 'IGST']];

  const body = order.items.map((it) => {
    const base = [it.hsnCode || '', it.name, String(it.qty), money(it.unitPrice), money(it.lineTotal), `${it.gstRate || 0}%`];
    return order.isIntraState ? [...base, money(it.cgstAmount), money(it.sgstAmount)] : [...base, money(it.igstAmount)];
  });

  autoTable(doc, { startY: 72, head, body, styles: { fontSize: 8 } });

  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.text(`Taxable Value: ${money(order.subtotal - order.discountTotal)}`, 140, y);
  y += 6;
  if (order.isIntraState) {
    doc.text(`CGST: ${money(order.cgstTotal)}`, 140, y);
    y += 6;
    doc.text(`SGST: ${money(order.sgstTotal)}`, 140, y);
    y += 6;
  } else {
    doc.text(`IGST: ${money(order.igstTotal)}`, 140, y);
    y += 6;
  }
  y += 4;
  doc.setFontSize(13);
  doc.text(`Grand Total: ${money(order.total)}`, 140, y);

  if (Number(order.amountDue) > 0) {
    y += 10;
    doc.setFontSize(10);
    doc.text(`Amount Paid: ${money(order.amountPaid)}`, 140, y);
    y += 6;
    doc.text(`Amount Due: ${money(order.amountDue)}`, 140, y);
  }

  return doc;
}

// Builds a one-page sales invoice as a jsPDF document - a compliance-style
// GST Tax Invoice (HSN codes, CGST/SGST or IGST breakdown, seller/buyer GSTIN)
// when order.invoiceType === 'gst', otherwise a simple Bill of Supply. `order`
// is the full response returned by the sales-order create/get endpoints.
// Does not save/download anything - callers decide whether to preview it,
// download it, or both.
export function buildSalesBillPDF(order) {
  const doc = new jsPDF();
  return order.invoiceType === 'gst' ? buildGstTaxInvoice(doc, order) : buildNonGstBill(doc, order);
}

// Object URLs (blob:) can be pointed at directly by an <iframe> for an
// in-browser preview. Caller is responsible for revoking it when done.
export function pdfPreviewUrl(doc) {
  return URL.createObjectURL(doc.output('blob'));
}

export function downloadPDF(doc, filename) {
  doc.save(filename);
}
