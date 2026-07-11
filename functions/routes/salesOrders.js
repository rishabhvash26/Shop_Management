const express = require('express');
const { db } = require('../firestore');

const router = express.Router();
const ORDERS = 'salesOrders';
const INVENTORY = 'inventory';
const TRANSACTIONS = 'transactions';
const SETTINGS = 'settings';
const PAYMENT_METHODS = ['cash', 'card', 'upi', 'credit'];
const INVOICE_TYPES = ['gst', 'non_gst'];
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function serializeOrder(doc) {
  const data = doc.data();
  return { id: doc.id, ...data };
}

// Resolves whether this order is GST-invoiced and, if so, whether it's an
// intra-state (CGST+SGST) or inter-state (IGST) supply, based on the shop's
// own registered state vs. the customer's state. Also snapshots the seller's
// GST details onto the order so historical invoices stay accurate even if
// Settings changes later.
async function resolveGstContext(invoiceType, customerState) {
  const gstMode = invoiceType === 'gst';
  if (!gstMode) {
    return { gstMode: false, isIntraState: true, placeOfSupply: '', sellerSnapshot: null };
  }

  const settingsDoc = await db.collection(SETTINGS).doc('shop').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  if (!settings.gstRegistered || !settings.gstin) {
    throw { status: 400, message: 'Cannot create a GST invoice: your shop is not marked GST-registered in Settings' };
  }

  const shopState = settings.state || '';
  const placeOfSupply = customerState || shopState;
  const isIntraState = shopState.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();

  return {
    gstMode: true,
    isIntraState,
    placeOfSupply,
    sellerSnapshot: {
      businessName: settings.businessName || '',
      address: settings.address || '',
      city: settings.city || '',
      state: shopState,
      pincode: settings.pincode || '',
      gstin: settings.gstin,
    },
  };
}

function computeLineItem(product, productId, qty, discountPercent, gstContext) {
  const requestedQty = Number(qty);
  const unitPrice = Number(product.unitPrice) || 0;
  const lineSubtotal = unitPrice * requestedQty;
  const discount = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  const discountAmount = lineSubtotal * (discount / 100);
  const lineTotal = lineSubtotal - discountAmount; // taxable value (post-discount, pre-GST)

  let gstRate = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;
  if (gstContext.gstMode) {
    gstRate = Number(product.gstRate) || 0;
    if (gstContext.isIntraState) {
      cgstAmount = lineTotal * (gstRate / 200);
      sgstAmount = lineTotal * (gstRate / 200);
    } else {
      igstAmount = lineTotal * (gstRate / 100);
    }
  }

  return {
    productId,
    sku: product.sku,
    name: product.name,
    hsnCode: gstContext.gstMode ? product.hsnCode || '' : '',
    qty: requestedQty,
    unitPrice,
    discountPercent: discount,
    lineSubtotal,
    discountAmount,
    lineTotal,
    gstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    returnedQty: 0,
  };
}

function computeOrderTotals(lineItems, taxPercent, gstContext) {
  const subtotal = lineItems.reduce((s, li) => s + li.lineSubtotal, 0);
  const discountTotal = lineItems.reduce((s, li) => s + li.discountAmount, 0);
  const taxableAmount = subtotal - discountTotal;

  let tax = 0;
  let taxAmount = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  if (gstContext.gstMode) {
    cgstTotal = lineItems.reduce((s, li) => s + li.cgstAmount, 0);
    sgstTotal = lineItems.reduce((s, li) => s + li.sgstAmount, 0);
    igstTotal = lineItems.reduce((s, li) => s + li.igstAmount, 0);
    taxAmount = cgstTotal + sgstTotal + igstTotal;
  } else {
    tax = Math.min(Math.max(Number(taxPercent) || 0, 0), 100);
    taxAmount = taxableAmount * (tax / 100);
  }

  const total = taxableAmount + taxAmount;
  return { subtotal, discountTotal, taxPercent: tax, taxAmount, cgstTotal, sgstTotal, igstTotal, total };
}

function paymentStatusFor(amountPaid, amountDue) {
  if (amountDue <= 0.0001) return 'paid';
  if (amountPaid > 0) return 'partially_paid';
  return 'unpaid';
}

function validateItemsShape(items, res) {
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Field "items" must be a non-empty array' });
    return false;
  }
  for (const item of items) {
    if (!item.productId || !item.qty || Number(item.qty) <= 0) {
      res.status(400).json({ error: 'Each item requires a valid "productId" and positive "qty"' });
      return false;
    }
    if (item.discountPercent !== undefined && (Number(item.discountPercent) < 0 || Number(item.discountPercent) > 100)) {
      res.status(400).json({ error: 'Field "discountPercent" must be between 0 and 100' });
      return false;
    }
  }
  return true;
}

function validateGstFields(invoiceType, customerGSTIN, res) {
  if (invoiceType !== undefined && !INVOICE_TYPES.includes(invoiceType)) {
    res.status(400).json({ error: `Field "invoiceType" must be one of ${INVOICE_TYPES.join(', ')}` });
    return false;
  }
  if (customerGSTIN && !GSTIN_PATTERN.test(String(customerGSTIN).toUpperCase())) {
    res.status(400).json({ error: 'Field "customerGSTIN" must be a valid 15-character GSTIN' });
    return false;
  }
  return true;
}

// GET /api/sales-orders
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection(ORDERS).orderBy('createdAt', 'desc').get();
    res.json(snapshot.docs.map(serializeOrder));
  } catch (err) {
    console.error('GET /sales-orders failed', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection(ORDERS).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Sales order not found' });
    }
    res.json(serializeOrder(doc));
  } catch (err) {
    console.error('GET /sales-orders/:id failed', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales-orders
router.post('/', async (req, res) => {
  const { customerName, items, taxPercent, customerGSTIN, customerState } = req.body;
  const paymentMethod = req.body.paymentMethod || 'cash';
  const invoiceType = req.body.invoiceType || 'non_gst';
  if (!customerName) {
    return res.status(400).json({ error: 'Field "customerName" is required' });
  }
  if (!validateItemsShape(items, res)) return;
  if (!validateGstFields(invoiceType, customerGSTIN, res)) return;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `Field "paymentMethod" must be one of ${PAYMENT_METHODS.join(', ')}` });
  }
  if (taxPercent !== undefined && (Number(taxPercent) < 0 || Number(taxPercent) > 100)) {
    return res.status(400).json({ error: 'Field "taxPercent" must be between 0 and 100' });
  }

  try {
    const gstContext = await resolveGstContext(invoiceType, customerState);

    const result = await db.runTransaction(async (tx) => {
      const productRefs = items.map((it) => db.collection(INVENTORY).doc(it.productId));
      const productDocs = await Promise.all(productRefs.map((ref) => tx.get(ref)));

      const lineItems = [];
      for (let i = 0; i < items.length; i++) {
        const { productId, qty, discountPercent } = items[i];
        const doc = productDocs[i];
        if (!doc.exists) {
          throw { status: 400, message: `Product ${productId} not found` };
        }
        const product = doc.data();
        const requestedQty = Number(qty);
        const available = Number(product.quantity) || 0;
        if (available < requestedQty) {
          throw {
            status: 400,
            message: `Insufficient stock for "${product.name}" (available: ${available}, requested: ${requestedQty})`,
          };
        }
        lineItems.push(computeLineItem(product, productId, requestedQty, discountPercent, gstContext));
      }

      // All validated - now write.
      for (let i = 0; i < items.length; i++) {
        const newQty = (Number(productDocs[i].data().quantity) || 0) - lineItems[i].qty;
        tx.update(productRefs[i], { quantity: newQty, updatedAt: new Date().toISOString() });
      }

      const totals = computeOrderTotals(lineItems, taxPercent, gstContext);
      const now = new Date().toISOString();
      const isCredit = paymentMethod === 'credit';

      const orderRef = db.collection(ORDERS).doc();
      const txnRef = isCredit ? null : db.collection(TRANSACTIONS).doc();

      const orderData = {
        customerName,
        items: lineItems,
        ...totals,
        invoiceType: gstContext.gstMode ? 'gst' : 'non_gst',
        customerGSTIN: gstContext.gstMode ? (customerGSTIN || '').toUpperCase() : '',
        customerState: gstContext.gstMode ? customerState || '' : '',
        placeOfSupply: gstContext.placeOfSupply,
        isIntraState: gstContext.isIntraState,
        sellerSnapshot: gstContext.sellerSnapshot,
        paymentMethod,
        paymentStatus: isCredit ? 'unpaid' : 'paid',
        amountPaid: isCredit ? 0 : totals.total,
        amountDue: isCredit ? totals.total : 0,
        totalRefunded: 0,
        transactionId: txnRef ? txnRef.id : null,
        status: 'completed',
        date: now,
        createdAt: now,
        history: [{ type: 'created', total: totals.total, date: now }],
      };
      tx.set(orderRef, orderData);

      if (txnRef) {
        tx.set(txnRef, {
          type: 'cash_in',
          amount: totals.total,
          note: `Sales order ${orderRef.id} (${paymentMethod})`,
          date: now,
          createdAt: now,
        });
      }

      return { id: orderRef.id, ...orderData };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('POST /sales-orders failed', err);
    res.status(500).json({ error: err.message || 'Failed to create sales order' });
  }
});

// PATCH /api/sales-orders/:id - metadata-only edit (customer name), always safe.
router.patch('/:id', async (req, res) => {
  try {
    const { customerName } = req.body;
    if (!customerName) {
      return res.status(400).json({ error: 'Field "customerName" is required' });
    }
    const ref = db.collection(ORDERS).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ error: 'Sales order not found' });
    }
    await ref.update({ customerName });
    const updated = await ref.get();
    res.json(serializeOrder(updated));
  } catch (err) {
    console.error('PATCH /sales-orders/:id failed', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sales-orders/:id - full edit (customer, items, discount, tax, payment method, GST).
// Only allowed while the order is still "completed" with no recorded credit payments yet,
// since editing re-derives inventory and cash effects from scratch.
router.put('/:id', async (req, res) => {
  const { customerName, items, taxPercent, customerGSTIN, customerState } = req.body;
  const paymentMethod = req.body.paymentMethod || 'cash';
  const invoiceType = req.body.invoiceType || 'non_gst';
  if (!customerName) {
    return res.status(400).json({ error: 'Field "customerName" is required' });
  }
  if (!validateItemsShape(items, res)) return;
  if (!validateGstFields(invoiceType, customerGSTIN, res)) return;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `Field "paymentMethod" must be one of ${PAYMENT_METHODS.join(', ')}` });
  }

  try {
    const gstContext = await resolveGstContext(invoiceType, customerState);

    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.collection(ORDERS).doc(req.params.id);
      const orderDoc = await tx.get(orderRef);
      if (!orderDoc.exists) {
        throw { status: 404, message: 'Sales order not found' };
      }
      const order = orderDoc.data();
      if (order.status !== 'completed') {
        throw { status: 400, message: `Cannot edit an order with status "${order.status}"` };
      }
      if (order.paymentMethod === 'credit' && Number(order.amountPaid) > 0) {
        throw {
          status: 400,
          message: 'Cannot edit an order that already has recorded payments; cancel it and create a new order instead',
        };
      }

      // Read every product touched by either the original or the new items, exactly once each.
      const productIds = [...new Set([...order.items.map((it) => it.productId), ...items.map((it) => it.productId)])];
      const productRefs = new Map(productIds.map((pid) => [pid, db.collection(INVENTORY).doc(pid)]));
      const productDocs = new Map();
      for (const [pid, ref] of productRefs.entries()) {
        productDocs.set(pid, await tx.get(ref));
      }

      // Start from on-hand quantity, then add back the original order's items (restock).
      const availableQty = new Map();
      for (const [pid, doc] of productDocs.entries()) {
        availableQty.set(pid, doc.exists ? Number(doc.data().quantity) || 0 : 0);
      }
      for (const li of order.items) {
        availableQty.set(li.productId, (availableQty.get(li.productId) || 0) + Number(li.qty));
      }

      // Validate and compute the new line items against the restocked availability.
      const lineItems = [];
      for (const { productId, qty, discountPercent } of items) {
        const doc = productDocs.get(productId);
        if (!doc || !doc.exists) {
          throw { status: 400, message: `Product ${productId} not found` };
        }
        const product = doc.data();
        const requestedQty = Number(qty);
        const available = availableQty.get(productId) || 0;
        if (available < requestedQty) {
          throw {
            status: 400,
            message: `Insufficient stock for "${product.name}" (available: ${available}, requested: ${requestedQty})`,
          };
        }
        availableQty.set(productId, available - requestedQty);
        lineItems.push(computeLineItem(product, productId, requestedQty, discountPercent, gstContext));
      }

      const now = new Date().toISOString();
      for (const pid of productIds) {
        tx.update(productRefs.get(pid), { quantity: availableQty.get(pid), updatedAt: now });
      }

      const totals = computeOrderTotals(lineItems, taxPercent, gstContext);
      const isCredit = paymentMethod === 'credit';

      // Reverse the original cash movement (if any) and record a fresh one for the corrected total.
      if (order.transactionId) {
        tx.delete(db.collection(TRANSACTIONS).doc(order.transactionId));
      }
      const txnRef = isCredit ? null : db.collection(TRANSACTIONS).doc();
      if (txnRef) {
        tx.set(txnRef, {
          type: 'cash_in',
          amount: totals.total,
          note: `Sales order ${req.params.id} (${paymentMethod}, edited)`,
          date: now,
          createdAt: now,
        });
      }

      const history = Array.isArray(order.history) ? [...order.history] : [];
      history.push({ type: 'edited', total: totals.total, date: now });

      const updates = {
        customerName,
        items: lineItems,
        ...totals,
        invoiceType: gstContext.gstMode ? 'gst' : 'non_gst',
        customerGSTIN: gstContext.gstMode ? (customerGSTIN || '').toUpperCase() : '',
        customerState: gstContext.gstMode ? customerState || '' : '',
        placeOfSupply: gstContext.placeOfSupply,
        isIntraState: gstContext.isIntraState,
        sellerSnapshot: gstContext.sellerSnapshot,
        paymentMethod,
        paymentStatus: isCredit ? 'unpaid' : 'paid',
        amountPaid: isCredit ? 0 : totals.total,
        amountDue: isCredit ? totals.total : 0,
        totalRefunded: 0,
        transactionId: txnRef ? txnRef.id : null,
        history,
      };
      tx.update(orderRef, updates);

      return { id: req.params.id, ...order, ...updates };
    });

    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('PUT /sales-orders/:id failed', err);
    res.status(500).json({ error: err.message || 'Failed to edit sales order' });
  }
});

// Shared core for /return and /cancel: restocks the requested quantities, computes the
// refund (taxable value plus its proportional GST), and settles it either as a reduction
// of what's owed (credit orders) or as cash handed back to the customer (already-paid orders).
async function processReturnOrCancel(orderId, requestedItems, mode) {
  return db.runTransaction(async (tx) => {
    const orderRef = db.collection(ORDERS).doc(orderId);
    const orderDoc = await tx.get(orderRef);
    if (!orderDoc.exists) {
      throw { status: 404, message: 'Sales order not found' };
    }
    const order = orderDoc.data();
    if (order.status !== 'completed' && order.status !== 'partially_returned') {
      throw { status: 400, message: `Cannot ${mode} an order with status "${order.status}"` };
    }

    const returnMap = new Map();
    if (mode === 'cancel') {
      for (const li of order.items) {
        const remaining = Number(li.qty) - Number(li.returnedQty || 0);
        if (remaining > 0) returnMap.set(li.productId, remaining);
      }
    } else {
      for (const reqItem of requestedItems) {
        returnMap.set(reqItem.productId, (returnMap.get(reqItem.productId) || 0) + Number(reqItem.qty));
      }
    }
    if (returnMap.size === 0) {
      throw { status: 400, message: 'Nothing to return' };
    }

    let refundTaxable = 0;
    let refundCgst = 0;
    let refundSgst = 0;
    let refundIgst = 0;
    const updatedItems = order.items.map((li) => ({ ...li }));
    for (const [productId, returnQty] of returnMap.entries()) {
      const line = updatedItems.find((li) => li.productId === productId);
      if (!line) {
        throw { status: 400, message: `Product ${productId} is not part of this order` };
      }
      const remaining = Number(line.qty) - Number(line.returnedQty || 0);
      if (returnQty > remaining) {
        throw { status: 400, message: `Cannot return ${returnQty} of "${line.name}"; only ${remaining} remain returnable` };
      }
      const originalQty = Number(line.qty);
      const netUnitPrice = Number(line.lineTotal) / originalQty;
      const netUnitCgst = Number(line.cgstAmount || 0) / originalQty;
      const netUnitSgst = Number(line.sgstAmount || 0) / originalQty;
      const netUnitIgst = Number(line.igstAmount || 0) / originalQty;

      refundTaxable += netUnitPrice * returnQty;
      refundCgst += netUnitCgst * returnQty;
      refundSgst += netUnitSgst * returnQty;
      refundIgst += netUnitIgst * returnQty;

      line.returnedQty = Number(line.returnedQty || 0) + returnQty;
      line.cgstAmount = Number(line.cgstAmount || 0) - netUnitCgst * returnQty;
      line.sgstAmount = Number(line.sgstAmount || 0) - netUnitSgst * returnQty;
      line.igstAmount = Number(line.igstAmount || 0) - netUnitIgst * returnQty;
    }
    const refundGst = refundCgst + refundSgst + refundIgst;
    const refundAmount = refundTaxable + refundGst;

    const productIds = [...returnMap.keys()];
    const productRefs = productIds.map((pid) => db.collection(INVENTORY).doc(pid));
    const productDocs = await Promise.all(productRefs.map((ref) => tx.get(ref)));
    const now = new Date().toISOString();
    for (let i = 0; i < productIds.length; i++) {
      const doc = productDocs[i];
      const currentQty = doc.exists ? Number(doc.data().quantity) || 0 : 0;
      tx.update(productRefs[i], { quantity: currentQty + returnMap.get(productIds[i]), updatedAt: now });
    }

    const allReturned = updatedItems.every((li) => Number(li.returnedQty || 0) >= Number(li.qty));
    const newStatus = mode === 'cancel' ? 'canceled' : allReturned ? 'returned' : 'partially_returned';

    let amountPaid = Number(order.amountPaid) || 0;
    let amountDue = Number(order.amountDue) || 0;
    let cashRefund = 0;

    if (order.paymentMethod === 'credit') {
      const reduceDue = Math.min(refundAmount, amountDue);
      amountDue -= reduceDue;
      const excess = refundAmount - reduceDue;
      if (excess > 0) {
        cashRefund = excess;
        amountPaid = Math.max(0, amountPaid - excess);
      }
    } else {
      cashRefund = refundAmount;
      amountPaid = Math.max(0, amountPaid - refundAmount);
    }

    if (cashRefund > 0) {
      const txnRef = db.collection(TRANSACTIONS).doc();
      tx.set(txnRef, {
        type: 'cash_out',
        amount: cashRefund,
        note: `${mode === 'cancel' ? 'Cancellation refund' : 'Return refund'} for sales order ${orderId}`,
        date: now,
        createdAt: now,
      });
    }

    const history = Array.isArray(order.history) ? [...order.history] : [];
    history.push({ type: mode, amount: refundAmount, cashRefund, date: now });

    const updates = {
      items: updatedItems,
      status: newStatus,
      total: Number(order.total) - refundAmount,
      taxAmount: Number(order.taxAmount || 0) - refundGst,
      cgstTotal: Number(order.cgstTotal || 0) - refundCgst,
      sgstTotal: Number(order.sgstTotal || 0) - refundSgst,
      igstTotal: Number(order.igstTotal || 0) - refundIgst,
      totalRefunded: (Number(order.totalRefunded) || 0) + refundAmount,
      amountPaid,
      amountDue,
      paymentStatus: paymentStatusFor(amountPaid, amountDue),
      history,
    };
    tx.update(orderRef, updates);

    return { id: orderId, ...order, ...updates };
  });
}

// POST /api/sales-orders/:id/return - partial or full return of specific line items.
router.post('/:id/return', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Field "items" must be a non-empty array' });
  }
  for (const item of items) {
    if (!item.productId || !item.qty || Number(item.qty) <= 0) {
      return res.status(400).json({ error: 'Each return item requires a valid "productId" and positive "qty"' });
    }
  }

  try {
    const result = await processReturnOrCancel(req.params.id, items, 'return');
    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('POST /sales-orders/:id/return failed', err);
    res.status(500).json({ error: err.message || 'Failed to process return' });
  }
});

// POST /api/sales-orders/:id/cancel - returns everything still outstanding on the order.
router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await processReturnOrCancel(req.params.id, null, 'cancel');
    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('POST /sales-orders/:id/cancel failed', err);
    res.status(500).json({ error: err.message || 'Failed to cancel order' });
  }
});

// POST /api/sales-orders/:id/payments - record a customer payment against a credit sale.
router.post('/:id/payments', async (req, res) => {
  const numericAmount = Number(req.body.amount);
  if (!req.body.amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Field "amount" must be a positive number' });
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.collection(ORDERS).doc(req.params.id);
      const orderDoc = await tx.get(orderRef);
      if (!orderDoc.exists) {
        throw { status: 404, message: 'Sales order not found' };
      }
      const order = orderDoc.data();
      if (order.status === 'returned' || order.status === 'canceled') {
        throw { status: 400, message: `Cannot record a payment against an order with status "${order.status}"` };
      }
      const amountDue = Number(order.amountDue) || 0;
      if (amountDue <= 0) {
        throw { status: 400, message: 'This order has no outstanding balance' };
      }
      if (numericAmount > amountDue) {
        throw { status: 400, message: `Payment amount exceeds the outstanding balance of $${amountDue.toFixed(2)}` };
      }

      const now = new Date().toISOString();
      const newAmountPaid = (Number(order.amountPaid) || 0) + numericAmount;
      const newAmountDue = amountDue - numericAmount;

      const txnRef = db.collection(TRANSACTIONS).doc();
      tx.set(txnRef, {
        type: 'cash_in',
        amount: numericAmount,
        note: `Payment for sales order ${req.params.id}`,
        date: now,
        createdAt: now,
      });

      const history = Array.isArray(order.history) ? [...order.history] : [];
      history.push({ type: 'payment', amount: numericAmount, date: now });

      const updates = {
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        paymentStatus: paymentStatusFor(newAmountPaid, newAmountDue),
        history,
      };
      tx.update(orderRef, updates);
      return { id: req.params.id, ...order, ...updates };
    });
    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('POST /sales-orders/:id/payments failed', err);
    res.status(500).json({ error: err.message || 'Failed to record payment' });
  }
});

module.exports = router;
