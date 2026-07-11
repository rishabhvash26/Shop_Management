const express = require('express');
const { db } = require('../firestore');

const router = express.Router();
const COLLECTION = 'settings';
const DOC_ID = 'shop';

const DEFAULTS = {
  businessName: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  gstin: '',
  gstRegistered: false,
};

// GSTIN: 2-digit state code + 10-char PAN + 1 entity code + 1 checksum ('Z') + 1 checksum digit/letter.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const ref = db.collection(COLLECTION).doc(DOC_ID);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.json({ id: DOC_ID, ...DEFAULTS });
    }
    res.json({ id: DOC_ID, ...DEFAULTS, ...doc.data() });
  } catch (err) {
    console.error('GET /settings failed', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  try {
    const { businessName, address, city, state, pincode, gstin, gstRegistered } = req.body;

    if (gstRegistered && !GSTIN_PATTERN.test(String(gstin || '').toUpperCase())) {
      return res.status(400).json({ error: 'A valid 15-character GSTIN is required when GST-registered is enabled' });
    }

    const updates = {
      businessName: businessName || '',
      address: address || '',
      city: city || '',
      state: state || '',
      pincode: pincode || '',
      gstin: gstRegistered ? String(gstin).toUpperCase() : '',
      gstRegistered: Boolean(gstRegistered),
      updatedAt: new Date().toISOString(),
    };

    const ref = db.collection(COLLECTION).doc(DOC_ID);
    await ref.set(updates, { merge: true });
    const doc = await ref.get();
    res.json({ id: DOC_ID, ...DEFAULTS, ...doc.data() });
  } catch (err) {
    console.error('PUT /settings failed', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
