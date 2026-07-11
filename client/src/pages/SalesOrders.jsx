import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildSalesBillPDF, pdfPreviewUrl, downloadPDF } from '../pdf.js';

function emptyLine() {
  return { productId: '', qty: '1', discountPercent: '0' };
}

const STATUS_BADGE = {
  completed: 'completed',
  partially_returned: 'warn',
  returned: 'neutral',
  canceled: 'neutral',
};

const PAYMENT_BADGE = {
  paid: 'ok',
  partially_paid: 'warn',
  unpaid: 'danger',
};

export default function SalesOrders() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const [editingOrderId, setEditingOrderId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [taxPercent, setTaxPercent] = useState('0');
  const [lines, setLines] = useState([emptyLine()]);

  const [returnPanelId, setReturnPanelId] = useState(null);
  const [returnQtys, setReturnQtys] = useState({});
  const [paymentPanelId, setPaymentPanelId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  const [billPreview, setBillPreview] = useState(null); // { doc, url, filename }
  const billPreviewRef = useRef(null);
  billPreviewRef.current = billPreview;

  useEffect(() => {
    return () => {
      if (billPreviewRef.current) URL.revokeObjectURL(billPreviewRef.current.url);
    };
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [ordersData, productsData] = await Promise.all([api.getSalesOrders(), api.getInventory()]);
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
    setCustomerName('');
    setPaymentMethod('cash');
    setTaxPercent('0');
    setLines([emptyLine()]);
  }

  function startEdit(order) {
    setError('');
    setSuccess('');
    setEditingOrderId(order.id);
    setCustomerName(order.customerName);
    setPaymentMethod(order.paymentMethod || 'cash');
    setTaxPercent(String(order.taxPercent || 0));
    setLines(
      order.items.map((it) => ({
        productId: it.productId,
        qty: String(it.qty),
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
      .filter((l) => l.productId && Number(l.qty) > 0)
      .map((l) => ({ productId: l.productId, qty: Number(l.qty), discountPercent: Number(l.discountPercent) || 0 }));

    if (!customerName || items.length === 0) {
      setError('Customer name and at least one valid line item are required.');
      return;
    }

    const payload = { customerName, paymentMethod, taxPercent: Number(taxPercent) || 0, items };

    try {
      if (editingOrderId) {
        await api.editSalesOrder(editingOrderId, payload);
        setSuccess(`Sales order ${editingOrderId} updated.`);
      } else {
        const order = await api.createSalesOrder(payload);
        showBillPreview(order);
        setSuccess(`Sales order ${order.id} created. Total: $${order.total.toFixed(2)}.`);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function showBillPreview(order) {
    if (billPreview) URL.revokeObjectURL(billPreview.url);
    const doc = buildSalesBillPDF(order);
    setBillPreview({ doc, url: pdfPreviewUrl(doc), filename: `invoice-${order.id}.pdf` });
  }

  function closeBillPreview() {
    if (billPreview) URL.revokeObjectURL(billPreview.url);
    setBillPreview(null);
  }

  function confirmDownloadBill() {
    if (!billPreview) return;
    downloadPDF(billPreview.doc, billPreview.filename);
    closeBillPreview();
  }

  async function handleCancelOrder(order) {
    if (!window.confirm(`Cancel sales order ${order.id}? This restocks all remaining items and refunds the customer.`)) return;
    setError('');
    setSuccess('');
    try {
      await api.cancelSalesOrder(order.id);
      setSuccess(`Sales order ${order.id} canceled.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleReturnPanel(order) {
    if (returnPanelId === order.id) {
      setReturnPanelId(null);
      return;
    }
    setError('');
    setSuccess('');
    setReturnPanelId(order.id);
    setPaymentPanelId(null);
    const initial = {};
    for (const li of order.items) {
      initial[li.productId] = '0';
    }
    setReturnQtys(initial);
  }

  async function handleReturnSubmit(order) {
    setError('');
    setSuccess('');
    const items = Object.entries(returnQtys)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([productId, qty]) => ({ productId, qty: Number(qty) }));
    if (items.length === 0) {
      setError('Enter a quantity to return for at least one item.');
      return;
    }
    try {
      await api.returnSalesOrderItems(order.id, { items });
      setSuccess(`Return processed for sales order ${order.id}.`);
      setReturnPanelId(null);
      load();
    } catch (err) {
      setError(err.message);
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
    setReturnPanelId(null);
    setPaymentAmount(String(order.amountDue));
  }

  async function handlePaymentSubmit(order) {
    setError('');
    setSuccess('');
    try {
      await api.paySalesOrder(order.id, { amount: Number(paymentAmount) });
      setSuccess(`Payment recorded for sales order ${order.id}.`);
      setPaymentPanelId(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h2>Sales Orders</h2>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="panel">
        <h3>{editingOrderId ? `Edit sales order ${editingOrderId}` : 'New sales order'}</h3>
        <form className="stack" onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
          <div className="form-row">
            <label>
              Customer name
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
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
                      {p.name} (in stock: {p.quantity}, ${Number(p.unitPrice).toFixed(2)})
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
            <button type="submit">{editingOrderId ? 'Save Changes' : 'Create Sales Order'}</button>
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
              <th>Customer</th>
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
              const canEdit = o.status === 'completed' && !(o.paymentMethod === 'credit' && o.amountPaid > 0);
              const canReturnOrCancel = o.status === 'completed' || o.status === 'partially_returned';
              const canPay = o.amountDue > 0 && o.status !== 'returned' && o.status !== 'canceled';
              return (
                <Fragment key={o.id}>
                  <tr>
                    <td>{o.id}</td>
                    <td>{o.customerName}</td>
                    <td>{new Date(o.date).toLocaleString()}</td>
                    <td>{o.items.map((it) => `${it.name} x${it.qty}`).join(', ')}</td>
                    <td>
                      ${Number(o.total).toFixed(2)}
                      {o.totalRefunded > 0 && <div className="muted">refunded ${Number(o.totalRefunded).toFixed(2)}</div>}
                    </td>
                    <td>
                      <div>{o.paymentMethod}</div>
                      <span className={`badge ${PAYMENT_BADGE[o.paymentStatus] || 'neutral'}`}>{o.paymentStatus}</span>
                      {o.amountDue > 0 && <div className="muted">due ${Number(o.amountDue).toFixed(2)}</div>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[o.status] || 'neutral'}`}>{o.status}</span>
                    </td>
                    <td>
                      <div className="action-group">
                        <button className="small secondary" onClick={() => showBillPreview(o)}>
                          Bill
                        </button>
                        {canEdit && (
                          <button className="small" onClick={() => startEdit(o)}>
                            Edit
                          </button>
                        )}
                        {canReturnOrCancel && (
                          <button className="small secondary" onClick={() => toggleReturnPanel(o)}>
                            Return
                          </button>
                        )}
                        {canReturnOrCancel && (
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
                  {returnPanelId === o.id && (
                    <tr>
                      <td colSpan={8}>
                        <div className="inline-panel">
                          <div className="form-row">
                            {o.items
                              .filter((li) => Number(li.qty) - Number(li.returnedQty || 0) > 0)
                              .map((li) => {
                                const remaining = Number(li.qty) - Number(li.returnedQty || 0);
                                return (
                                  <label key={li.productId}>
                                    {li.name} (max {remaining})
                                    <input
                                      type="number"
                                      min="0"
                                      max={remaining}
                                      value={returnQtys[li.productId] || '0'}
                                      onChange={(e) => setReturnQtys({ ...returnQtys, [li.productId]: e.target.value })}
                                    />
                                  </label>
                                );
                              })}
                          </div>
                          <div className="action-group" style={{ marginTop: '0.5rem' }}>
                            <button className="small" onClick={() => handleReturnSubmit(o)}>
                              Submit Return
                            </button>
                            <button className="small secondary" onClick={() => setReturnPanelId(null)}>
                              Close
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
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
                <td colSpan={8} className="muted">No sales orders yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {billPreview && (
        <div className="modal-overlay" onClick={closeBillPreview}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Bill Preview</h3>
              <button className="small secondary" onClick={closeBillPreview}>
                Close
              </button>
            </div>
            <iframe src={billPreview.url} title="Bill preview" />
            <div className="action-group" style={{ marginTop: '0.75rem' }}>
              <button onClick={confirmDownloadBill}>Download PDF</button>
              <button className="secondary" onClick={closeBillPreview}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
