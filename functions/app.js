const express = require('express');
const cors = require('cors');

require('./firestore');

const inventoryRouter = require('./routes/inventory');
const salesOrdersRouter = require('./routes/salesOrders');
const purchaseOrdersRouter = require('./routes/purchaseOrders');
const transactionsRouter = require('./routes/transactions');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', emulatorHost: process.env.FIRESTORE_EMULATOR_HOST || null });
});

app.use('/api/inventory', inventoryRouter);
app.use('/api/sales-orders', salesOrdersRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/transactions', transactionsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// Central error handler (in case any route forwards an error via next(err))
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
