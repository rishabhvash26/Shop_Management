import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';

function emptyLine() {
  return { productId: '', qty: '1', cost: '', discountPercent: '0' };
}

const STATUS_BADGE = {
  pending: 'pending',
  received: 'received',
  canceled: 'neutral',
};

const PAYMENT_BADGE = {
  paid: 'ok',
  partially_paid: 'warn',
  unpaid: 'danger',
};

export default function PurchaseOrders() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [receivingId, setReceivingId] = useState(null);

  const [editingOrderId, setEditingOrderId] = useState(null);
  const [supplierName, setSupplierName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [taxPercent, setTaxPercent] = useState('0');
  const [lines, setLines] = useState([emptyLine()]);

  const [paymentPanelId, setPaymentPanelId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  async function load() {
    try {
      setLoading(true);
      const [ordersData, productsData] = await Promise.all([api.getPurchaseOrders(), api.getInventory()]);
      setOrders(ordersData);
      setProducts(productsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateLine(index, field, value) {
    const next = [...lines];
    next[index] = { ...next[index], [field]: value };
    setLines(next);
  }

  function addLine() {
    setLines([...lines, emptyLine()]);
  }

  function removeLine(index) {
    setLines(lines.filter((_, i) => i !== index));
  }

  function resetForm() {
    setEditingOrderId(null);
    setSupplierName('');
    setPaymentMethod('cash');
    setTaxPercent('0');
    setLines([emptyLine()]);
  }

  function startEdit(order) {
    setError('');
    setSuccess('');
    setEditingOrderId(order.id);
    setSupplierName(order.supplierName);
    setPaymentMethod(order.paymentMethod || 'cash');
    setTaxPercent(String(order.taxPercent || 0));
    setLines(
      order.items.map((it) => ({
        productId: it.productId,
        qty: String(it.qty),
        cost: String(it.cost),
        discountPercent: String(it.discountPercent || 0),
      }))
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const items = lines
      .filter((l) => l.productId && Number(l.qty) > 0 && l.cost !== '')
      .map((l) => ({
        productId: l.productId,
        qty: Number(l.qty),
        cost: Number(l.cost),
        discountPercent: Number(l.discountPercent) || 0,
      }));

    if (!supplierName || items.length === 0) {
      setError('Supplier name and at least one valid line item (with cost) are required.');
      return;
    }

    const payload = { supplierName, paymentMethod, taxPercent: Number(taxPercent) || 0, items };

    try {
      if (editingOrderId) {
        await api.editPurchaseOrder(editingOrderId, payload);
        setSuccess(`Purchase order ${editingOrderId} updated.`);
      } else {
        const order = await api.createPurchaseOrder(payload);
        setSuccess(`Purchase order ${order.id} created (pending). Total: $${order.total.toFixed(2)}`);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCancelOrder(order) {
    if (!window.confirm(`Cancel purchase order ${order.id}?`)) return;
    setError('');
    setSuccess('');
    try {
      await api.cancelPurchaseOrder(order.id);
      setSuccess(`Purchase order ${order.id} canceled.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReceive(id) {
    setError('');
    setSuccess('');
    setReceivingId(id);
    try {
      await api.receivePurchaseOrder(id);
      setSuccess(`Purchase order ${id} received. Inventory updated.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setReceivingId(null);
    }
  }

  function togglePaymentPanel(order) {
    if (paymentPanelId === order.id) {
      setPaymentPanelId(null);
      return;
    }
    setError('');
    setSuccess('');
    setPaymentPanelId(order.id);
    setPaymentAmount(String(order.amountDue));
  }

  async function handlePaymentSubmit(order) {
    setError('');
    setSuccess('');
    try {
      await api.payPurchaseOrder(order.id, { amount: Number(paymentAmount) });
      setSuccess(`Payment recorded for purchase order ${order.id}.`);
      setPaymentPanelId(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h2>Purchase Orders</h2>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="panel">
        <h3>{editingOrderId ? `Edit purchase order ${editingOrderId}` : 'New purchase order'}</h3>
        <form className="stack" onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
          <div className="form-row">
            <label>
              Supplier name
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required />
            </label>
            <label>
              Payment method
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="credit">Credit (pay later)</option>
              </select>
            </label>
            <label>
              Tax %
              <input type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
            </label>
          </div>

          <div>
            <label style={{ marginBottom: '0.4rem' }}>Line items</label>
            {lines.map((line, idx) => (
              <div className="line-item-row" key={idx}>
                <select value={line.productId} onChange={(e) => updateLine(idx, 'productId', e.target.value)} required>
                  <option value="">Select product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (current stock: {p.quantity})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Cost per unit"
                  value={line.cost}
                  onChange={(e) => updateLine(idx, 'cost', e.target.value)}
                  required
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="Discount %"
                  value={line.discountPercent}
                  onChange={(e) => updateLine(idx, 'discountPercent', e.target.value)}
                />
                <button type="button" className="small secondary" onClick={() => removeLine(idx)} disabled={lines.length === 1}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="secondary small" onClick={addLine}>
              + Add line
            </button>
          </div>

          <div className="action-group">
            <button type="submit">{editingOrderId ? 'Save Changes' : 'Create Purchase Order'}</button>
            {editingOrderId && (
              <button type="button" className="secondary" onClick={resetForm}>
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="panel">
        <h3>Orders {loading && <span className="muted">(loading...)</span>}</h3>
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const canEdit = o.status === 'pending';
              const canCancel = o.status === 'pending';
              const canPay = o.status === 'received' && o.amountDue > 0;
              return (
                <Fragment key={o.id}>
                  <tr>
                    <td>{o.id}</td>
                    <td>{o.supplierName}</td>
                    <td>{new Date(o.date).toLocaleString()}</td>
                    <td>{o.items.map((it) => `${it.name} x${it.qty}`).join(', ')}</td>
                    <td>${Number(o.total).toFixed(2)}</td>
                    <td>
                      <div>{o.paymentMethod}</div>
                      {o.paymentStatus && (
                        <>
                          <span className={`badge ${PAYMENT_BADGE[o.paymentStatus] || 'neutral'}`}>{o.paymentStatus}</span>
                          {o.amountDue > 0 && <div className="muted">due ${Number(o.amountDue).toFixed(2)}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[o.status] || 'neutral'}`}>{o.status}</span>
                    </td>
                    <td>
                      <div className="action-group">
                        {o.status === 'pending' && (
                          <button className="small" disabled={receivingId === o.id} onClick={() => handleReceive(o.id)}>
                            {receivingId === o.id ? 'Receiving...' : 'Receive'}
                          </button>
                        )}
                        {canEdit && (
                          <button className="small secondary" onClick={() => startEdit(o)}>
                            Edit
                          </button>
                        )}
                        {canCancel && (
                          <button className="small secondary" onClick={() => handleCancelOrder(o)}>
                            Cancel
                          </button>
                        )}
                        {canPay && (
                          <button className="small secondary" onClick={() => togglePaymentPanel(o)}>
                            Record Payment
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {paymentPanelId === o.id && (
                    <tr>
                      <td colSpan={8}>
                        <div className="inline-panel">
                          <div className="form-row">
                            <label>
                              Amount (outstanding: ${Number(o.amountDue).toFixed(2)})
                              <input
                                type="number"
                                min="0.01"
                                max={o.amountDue}
                                step="0.01"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                              />
                            </label>
                          </div>
                          <div className="action-group" style={{ marginTop: '0.5rem' }}>
                            <button className="small" onClick={() => handlePaymentSubmit(o)}>
                              Record Payment
                            </button>
                            <button className="small secondary" onClick={() => setPaymentPanelId(null)}>
                              Close
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {orders.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="muted">No purchase orders yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
