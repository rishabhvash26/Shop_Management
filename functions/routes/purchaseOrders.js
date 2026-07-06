const express = require('express');
const { db } = require('../firestore');

const router = express.Router();
const ORDERS = 'purchaseOrders';
const INVENTORY = 'inventory';
const TRANSACTIONS = 'transactions';
const PAYMENT_METHODS = ['cash', 'card', 'upi', 'credit'];

function serializeOrder(doc) {
  const data = doc.data();
  return { id: doc.id, ...data };
}

function computeLineItem(product, productId, qty, cost, discountPercent) {
  const requestedQty = Number(qty);
  const unitCost = Number(cost);
  const lineSubtotal = unitCost * requestedQty;
  const discount = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  const discountAmount = lineSubtotal * (discount / 100);
  const lineTotal = lineSubtotal - discountAmount;
  return {
    productId,
    sku: product.sku,
    name: product.name,
    qty: requestedQty,
    cost: unitCost,
    discountPercent: discount,
    lineSubtotal,
    discountAmount,
    lineTotal,
  };
}

function computeOrderTotals(lineItems, taxPercent) {
  const subtotal = lineItems.reduce((s, li) => s + li.lineSubtotal, 0);
  const discountTotal = lineItems.reduce((s, li) => s + li.discountAmount, 0);
  const taxableAmount = subtotal - discountTotal;
  const tax = Math.min(Math.max(Number(taxPercent) || 0, 0), 100);
  const taxAmount = taxableAmount * (tax / 100);
  const total = taxableAmount + taxAmount;
  return { subtotal, discountTotal, taxPercent: tax, taxAmount, total };
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
    if (!item.productId || !item.qty || Number(item.qty) <= 0 || item.cost === undefined || Number(item.cost) < 0) {
      res.status(400).json({ error: 'Each item requires a valid "productId", positive "qty", and "cost"' });
      return false;
    }
    if (item.discountPercent !== undefined && (Number(item.discountPercent) < 0 || Number(item.discountPercent) > 100)) {
      res.status(400).json({ error: 'Field "discountPercent" must be between 0 and 100' });
      return false;
    }
  }
  return true;
}

// GET /api/purchase-orders
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection(ORDERS).orderBy('createdAt', 'desc').get();
    res.json(snapshot.docs.map(serializeOrder));
  } catch (err) {
    console.error('GET /purchase-orders failed', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection(ORDERS).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(serializeOrder(doc));
  } catch (err) {
    console.error('GET /purchase-orders/:id failed', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/purchase-orders
router.post('/', async (req, res) => {
  const { supplierName, items, taxPercent } = req.body;
  const paymentMethod = req.body.paymentMethod || 'cash';
  if (!supplierName) {
    return res.status(400).json({ error: 'Field "supplierName" is required' });
  }
  if (!validateItemsShape(items, res)) return;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `Field "paymentMethod" must be one of ${PAYMENT_METHODS.join(', ')}` });
  }
  if (taxPercent !== undefined && (Number(taxPercent) < 0 || Number(taxPercent) > 100)) {
    return res.status(400).json({ error: 'Field "taxPercent" must be between 0 and 100' });
  }

  try {
    const productRefs = items.map((it) => db.collection(INVENTORY).doc(it.productId));
    const productDocs = await Promise.all(productRefs.map((ref) => ref.get()));

    const lineItems = [];
    for (let i = 0; i < items.length; i++) {
      const doc = productDocs[i];
      if (!doc.exists) {
        return res.status(400).json({ error: `Product ${items[i].productId} not found` });
      }
      lineItems.push(computeLineItem(doc.data(), items[i].productId, items[i].qty, items[i].cost, items[i].discountPercent));
    }

    const totals = computeOrderTotals(lineItems, taxPercent);
    const now = new Date().toISOString();
    const orderData = {
      supplierName,
      items: lineItems,
      ...totals,
      paymentMethod,
      status: 'pending',
      date: now,
      createdAt: now,
    };
    const orderRef = await db.collection(ORDERS).add(orderData);
    res.status(201).json({ id: orderRef.id, ...orderData });
  } catch (err) {
    console.error('POST /purchase-orders failed', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/purchase-orders/:id - full edit, only while still pending (nothing has been
// applied to inventory or cash yet, so no reversal is needed).
router.put('/:id', async (req, res) => {
  const { supplierName, items, taxPercent } = req.body;
  const paymentMethod = req.body.paymentMethod || 'cash';
  if (!supplierName) {
    return res.status(400).json({ error: 'Field "supplierName" is required' });
  }
  if (!validateItemsShape(items, res)) return;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `Field "paymentMethod" must be one of ${PAYMENT_METHODS.join(', ')}` });
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.collection(ORDERS).doc(req.params.id);
      const orderDoc = await tx.get(orderRef);
      if (!orderDoc.exists) {
        throw { status: 404, message: 'Purchase order not found' };
      }
      const order = orderDoc.data();
      if (order.status !== 'pending') {
        throw { status: 400, message: `Cannot edit a purchase order with status "${order.status}"` };
      }

      const productRefs = items.map((it) => db.collection(INVENTORY).doc(it.productId));
      const productDocs = await Promise.all(productRefs.map((ref) => tx.get(ref)));
      const lineItems = [];
      for (let i = 0; i < items.length; i++) {
        const doc = productDocs[i];
        if (!doc.exists) {
          throw { status: 400, message: `Product ${items[i].productId} not found` };
        }
        lineItems.push(computeLineItem(doc.data(), items[i].productId, items[i].qty, items[i].cost, items[i].discountPercent));
      }

      const totals = computeOrderTotals(lineItems, taxPercent);
      const updates = { supplierName, items: lineItems, ...totals, paymentMethod };
      tx.update(orderRef, updates);
      return { id: req.params.id, ...order, ...updates };
    });
    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('PUT /purchase-orders/:id failed', err);
    res.status(500).json({ error: err.message || 'Failed to edit purchase order' });
  }
});

// POST /api/purchase-orders/:id/cancel - only while still pending.
router.post('/:id/cancel', async (req, res) => {
  try {
    const ref = db.collection(ORDERS).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    const order = existing.data();
    if (order.status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel a purchase order with status "${order.status}"` });
    }
    await ref.update({ status: 'canceled' });
    const updated = await ref.get();
    res.json(serializeOrder(updated));
  } catch (err) {
    console.error('POST /purchase-orders/:id/cancel failed', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/purchase-orders/:id/receive
router.patch('/:id/receive', async (req, res) => {
  try {
    const orderRef = db.collection(ORDERS).doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const orderDoc = await tx.get(orderRef);
      if (!orderDoc.exists) {
        throw { status: 404, message: 'Purchase order not found' };
      }
      const order = orderDoc.data();
      if (order.status !== 'pending') {
        throw {
          status: 400,
          message:
            order.status === 'received'
              ? 'Purchase order has already been received'
              : `Cannot receive a purchase order with status "${order.status}"`,
        };
      }

      const productRefs = order.items.map((it) => db.collection(INVENTORY).doc(it.productId));
      const productDocs = await Promise.all(productRefs.map((ref) => tx.get(ref)));

      for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const doc = productDocs[i];
        if (!doc.exists) {
          throw { status: 400, message: `Product ${item.productId} no longer exists in inventory` };
        }
        const currentQty = Number(doc.data().quantity) || 0;
        tx.update(productRefs[i], {
          quantity: currentQty + Number(item.qty),
          updatedAt: new Date().toISOString(),
        });
      }

      const now = new Date().toISOString();
      const total = Number(order.total) || 0;
      const isCredit = order.paymentMethod === 'credit';
      const txnRef = isCredit ? null : db.collection(TRANSACTIONS).doc();

      if (txnRef) {
        tx.set(txnRef, {
          type: 'cash_out',
          amount: total,
          note: `Purchase order ${orderRef.id}`,
          date: now,
          createdAt: now,
        });
      }

      const updates = {
        status: 'received',
        receivedAt: now,
        paymentStatus: isCredit ? 'unpaid' : 'paid',
        amountPaid: isCredit ? 0 : total,
        amountDue: isCredit ? total : 0,
        transactionId: txnRef ? txnRef.id : null,
      };
      tx.update(orderRef, updates);

      return { id: orderRef.id, ...order, ...updates };
    });

    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('PATCH /purchase-orders/:id/receive failed', err);
    res.status(500).json({ error: err.message || 'Failed to receive purchase order' });
  }
});

// POST /api/purchase-orders/:id/payments - record a payment to the supplier on a
// received purchase order that was bought on credit terms.
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
        throw { status: 404, message: 'Purchase order not found' };
      }
      const order = orderDoc.data();
      if (order.status !== 'received') {
        throw { status: 400, message: 'Payments can only be recorded against a received purchase order' };
      }
      const amountDue = Number(order.amountDue) || 0;
      if (amountDue <= 0) {
        throw { status: 400, message: 'This purchase order has no outstanding balance' };
      }
      if (numericAmount > amountDue) {
        throw { status: 400, message: `Payment amount exceeds the outstanding balance of $${amountDue.toFixed(2)}` };
      }

      const now = new Date().toISOString();
      const newAmountPaid = (Number(order.amountPaid) || 0) + numericAmount;
      const newAmountDue = amountDue - numericAmount;

      const txnRef = db.collection(TRANSACTIONS).doc();
      tx.set(txnRef, {
        type: 'cash_out',
        amount: numericAmount,
        note: `Payment for purchase order ${req.params.id}`,
        date: now,
        createdAt: now,
      });

      const updates = {
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        paymentStatus: paymentStatusFor(newAmountPaid, newAmountDue),
      };
      tx.update(orderRef, updates);
      return { id: req.params.id, ...order, ...updates };
    });
    res.json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('POST /purchase-orders/:id/payments failed', err);
    res.status(500).json({ error: err.message || 'Failed to record payment' });
  }
});

module.exports = router;
