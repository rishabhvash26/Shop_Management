const express = require('express');
const { db } = require('../firestore');

const router = express.Router();
const COLLECTION = 'transactions';

function serialize(doc) {
  return { id: doc.id, ...doc.data() };
}

// GET /api/transactions?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    const snapshot = await db.collection(COLLECTION).orderBy('createdAt', 'desc').get();
    let transactions = snapshot.docs.map(serialize);

    if (date) {
      transactions = transactions.filter((t) => (t.date || '').slice(0, 10) === date);
    }

    const summary = transactions.reduce(
      (acc, t) => {
        const amount = Number(t.amount) || 0;
        if (t.type === 'cash_in') acc.totalIn += amount;
        else if (t.type === 'cash_out') acc.totalOut += amount;
        return acc;
      },
      { totalIn: 0, totalOut: 0 }
    );
    summary.net = summary.totalIn - summary.totalOut;

    res.json({ transactions, summary });
  } catch (err) {
    console.error('GET /transactions failed', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions (manual entries)
router.post('/', async (req, res) => {
  try {
    const { type, amount, note } = req.body;
    if (type !== 'cash_in' && type !== 'cash_out') {
      return res.status(400).json({ error: 'Field "type" must be "cash_in" or "cash_out"' });
    }
    const numericAmount = Number(amount);
    if (amount === undefined || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Field "amount" must be a positive number' });
    }

    const now = new Date().toISOString();
    const data = {
      type,
      amount: numericAmount,
      note: note || '',
      date: now,
      createdAt: now,
    };
    const ref = await db.collection(COLLECTION).add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    console.error('POST /transactions failed', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
