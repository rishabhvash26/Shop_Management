const express = require('express');
const { db, admin } = require('../firestore');

const router = express.Router();
const COLLECTION = 'inventory';

function toNumber(value, fieldName) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || Number.isNaN(n)) {
    throw new Error(`Field "${fieldName}" must be a number`);
  }
  if (n < 0) {
    throw new Error(`Field "${fieldName}" must not be negative`);
  }
  return n;
}

function toGstRate(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0 || n > 100) {
    throw new Error('Field "gstRate" must be a number between 0 and 100');
  }
  return n;
}

function serialize(doc) {
  const data = doc.data();
  const quantity = Number(data.quantity) || 0;
  const lowStockThreshold = Number(data.lowStockThreshold) || 0;
  return {
    id: doc.id,
    sku: data.sku,
    name: data.name,
    category: data.category,
    quantity,
    unitPrice: Number(data.unitPrice) || 0,
    lowStockThreshold,
    isLowStock: quantity <= lowStockThreshold,
    hsnCode: data.hsnCode || '',
    gstRate: Number(data.gstRate) || 0,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

// GET /api/inventory
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTION).orderBy('name').get();
    const items = snapshot.docs.map(serialize);
    res.json(items);
  } catch (err) {
    console.error('GET /inventory failed', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory
router.post('/', async (req, res) => {
  try {
    const { sku, name, category, hsnCode } = req.body;
    if (!sku || !name) {
      return res.status(400).json({ error: 'Fields "sku" and "name" are required' });
    }
    const quantity = toNumber(req.body.quantity, 'quantity');
    const unitPrice = toNumber(req.body.unitPrice, 'unitPrice');
    const lowStockThreshold = toNumber(req.body.lowStockThreshold, 'lowStockThreshold');
    const gstRate = toGstRate(req.body.gstRate);

    const now = new Date().toISOString();
    const docRef = await db.collection(COLLECTION).add({
      sku,
      name,
      category: category || '',
      quantity,
      unitPrice,
      lowStockThreshold,
      hsnCode: hsnCode || '',
      gstRate,
      createdAt: now,
      updatedAt: now,
    });
    const doc = await docRef.get();
    res.status(201).json(serialize(doc));
  } catch (err) {
    console.error('POST /inventory failed', err);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/inventory/:id
router.put('/:id', async (req, res) => {
  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    const { sku, name, category, quantity, unitPrice, lowStockThreshold, hsnCode, gstRate } = req.body;
    if (sku !== undefined) updates.sku = sku;
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (quantity !== undefined) updates.quantity = toNumber(quantity, 'quantity');
    if (unitPrice !== undefined) updates.unitPrice = toNumber(unitPrice, 'unitPrice');
    if (lowStockThreshold !== undefined) {
      updates.lowStockThreshold = toNumber(lowStockThreshold, 'lowStockThreshold');
    }
    if (hsnCode !== undefined) updates.hsnCode = hsnCode;
    if (gstRate !== undefined) updates.gstRate = toGstRate(gstRate);

    await ref.update(updates);
    const doc = await ref.get();
    res.json(serialize(doc));
  } catch (err) {
    console.error('PUT /inventory/:id failed', err);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/inventory/:id
router.delete('/:id', async (req, res) => {
  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    await ref.delete();
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('DELETE /inventory/:id failed', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
