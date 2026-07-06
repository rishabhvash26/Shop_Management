import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { downloadCSV } from '../utils.js';

function inRange(dateStr, from, to) {
  const day = dateStr.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  const [inventory, setInventory] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [salesFilters, setSalesFilters] = useState({ from: '', to: '', paymentMethod: '', status: '', customerName: '' });
  const [purchaseFilters, setPurchaseFilters] = useState({ from: '', to: '', paymentMethod: '', status: '', supplierName: '' });
  const [inventoryFilters, setInventoryFilters] = useState({ category: '', lowStockOnly: false });
  const [customerSearch, setCustomerSearch] = useState('');
  const [expandedCustomer, setExpandedCustomer] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const [inv, sales, purchases] = await Promise.all([
        api.getInventory(),
        api.getSalesOrders(),
        api.getPurchaseOrders(),
      ]);
      setInventory(inv);
      setSalesOrders(sales);
      setPurchaseOrders(purchases);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredSales = useMemo(
    () =>
      salesOrders.filter((o) => {
        if (!inRange(o.date, salesFilters.from, salesFilters.to)) return false;
        if (salesFilters.paymentMethod && o.paymentMethod !== salesFilters.paymentMethod) return false;
        if (salesFilters.status && o.status !== salesFilters.status) return false;
        if (salesFilters.customerName && !o.customerName.toLowerCase().includes(salesFilters.customerName.toLowerCase())) {
          return false;
        }
        return true;
      }),
    [salesOrders, salesFilters]
  );

  const filteredPurchases = useMemo(
    () =>
      purchaseOrders.filter((o) => {
        if (!inRange(o.date, purchaseFilters.from, purchaseFilters.to)) return false;
        if (purchaseFilters.paymentMethod && o.paymentMethod !== purchaseFilters.paymentMethod) return false;
        if (purchaseFilters.status && o.status !== purchaseFilters.status) return false;
        if (
          purchaseFilters.supplierName &&
          !o.supplierName.toLowerCase().includes(purchaseFilters.supplierName.toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [purchaseOrders, purchaseFilters]
  );

  const categories = useMemo(() => [...new Set(inventory.map((i) => i.category).filter(Boolean))].sort(), [inventory]);

  const filteredInventory = useMemo(
    () =>
      inventory.filter((i) => {
        if (inventoryFilters.category && i.category !== inventoryFilters.category) return false;
        if (inventoryFilters.lowStockOnly && !i.isLowStock) return false;
        return true;
      }),
    [inventory, inventoryFilters]
  );

  const customerBalances = useMemo(() => {
    const byCustomer = new Map();
    for (const o of salesOrders) {
      const due = Number(o.amountDue || 0);
      if (due <= 0) continue;
      if (customerSearch && !o.customerName.toLowerCase().includes(customerSearch.toLowerCase())) continue;

      const entry = byCustomer.get(o.customerName) || {
        customerName: o.customerName,
        totalDue: 0,
        orderCount: 0,
        oldestDate: o.date,
        orders: [],
      };
      entry.totalDue += due;
      entry.orderCount += 1;
      entry.orders.push(o);
      if (new Date(o.date) < new Date(entry.oldestDate)) entry.oldestDate = o.date;
      byCustomer.set(o.customerName, entry);
    }
    return [...byCustomer.values()].sort((a, b) => b.totalDue - a.totalDue);
  }, [salesOrders, customerSearch]);

  const totalReceivable = customerBalances.reduce((s, c) => s + c.totalDue, 0);

  const salesTotals = filteredSales.reduce(
    (acc, o) => {
      acc.revenue += Number(o.total);
      acc.discount += Number(o.discountTotal || 0);
      acc.tax += Number(o.taxAmount || 0);
      acc.outstanding += Number(o.amountDue || 0);
      return acc;
    },
    { revenue: 0, discount: 0, tax: 0, outstanding: 0 }
  );

  const purchaseTotals = filteredPurchases.reduce(
    (acc, o) => {
      acc.spend += Number(o.total);
      acc.discount += Number(o.discountTotal || 0);
      acc.tax += Number(o.taxAmount || 0);
      acc.outstanding += Number(o.amountDue || 0);
      return acc;
    },
    { spend: 0, discount: 0, tax: 0, outstanding: 0 }
  );

  const inventoryTotals = filteredInventory.reduce(
    (acc, i) => {
      acc.units += Number(i.quantity);
      acc.value += Number(i.quantity) * Number(i.unitPrice);
      return acc;
    },
    { units: 0, value: 0 }
  );

  function exportSales() {
    downloadCSV(
      'sales-report.csv',
      [
        { key: 'id', label: 'Order ID' },
        { key: 'customerName', label: 'Customer' },
        { key: 'date', label: 'Date' },
        { key: 'total', label: 'Total' },
        { key: 'paymentMethod', label: 'Payment Method' },
        { key: 'paymentStatus', label: 'Payment Status' },
        { key: 'amountDue', label: 'Amount Due' },
        { key: 'status', label: 'Status' },
      ],
      filteredSales
    );
  }

  function exportPurchases() {
    downloadCSV(
      'purchases-report.csv',
      [
        { key: 'id', label: 'Order ID' },
        { key: 'supplierName', label: 'Supplier' },
        { key: 'date', label: 'Date' },
        { key: 'total', label: 'Total' },
        { key: 'paymentMethod', label: 'Payment Method' },
        { key: 'status', label: 'Status' },
      ],
      filteredPurchases
    );
  }

  function exportReceivables() {
    downloadCSV(
      'customer-outstanding-report.csv',
      [
        { key: 'customerName', label: 'Customer' },
        { key: 'orderCount', label: 'Orders Outstanding' },
        { key: 'totalDue', label: 'Total Owed' },
        { key: 'oldestDate', label: 'Oldest Outstanding Since' },
      ],
      customerBalances
    );
  }

  function exportInventory() {
    downloadCSV(
      'inventory-report.csv',
      [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'quantity', label: 'Quantity' },
        { key: 'unitPrice', label: 'Unit Price' },
        { key: 'isLowStock', label: 'Low Stock' },
      ],
      filteredInventory
    );
  }

  return (
    <div className="page">
      <h2>Reports</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="action-group" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'sales' ? '' : 'secondary'} onClick={() => setTab('sales')}>
          Sales
        </button>
        <button className={tab === 'purchases' ? '' : 'secondary'} onClick={() => setTab('purchases')}>
          Purchases
        </button>
        <button className={tab === 'inventory' ? '' : 'secondary'} onClick={() => setTab('inventory')}>
          Inventory
        </button>
        <button className={tab === 'receivables' ? '' : 'secondary'} onClick={() => setTab('receivables')}>
          Outstanding by Customer
        </button>
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && tab === 'sales' && (
        <>
          <div className="panel">
            <h3>Filters</h3>
            <div className="form-row">
              <label>
                From
                <input type="date" value={salesFilters.from} onChange={(e) => setSalesFilters({ ...salesFilters, from: e.target.value })} />
              </label>
              <label>
                To
                <input type="date" value={salesFilters.to} onChange={(e) => setSalesFilters({ ...salesFilters, to: e.target.value })} />
              </label>
              <label>
                Payment method
                <select
                  value={salesFilters.paymentMethod}
                  onChange={(e) => setSalesFilters({ ...salesFilters, paymentMethod: e.target.value })}
                >
                  <option value="">All</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="credit">Credit</option>
                </select>
              </label>
              <label>
                Status
                <select value={salesFilters.status} onChange={(e) => setSalesFilters({ ...salesFilters, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="completed">Completed</option>
                  <option value="partially_returned">Partially returned</option>
                  <option value="returned">Returned</option>
                  <option value="canceled">Canceled</option>
                </select>
              </label>
              <label>
                Customer
                <input
                  value={salesFilters.customerName}
                  onChange={(e) => setSalesFilters({ ...salesFilters, customerName: e.target.value })}
                  placeholder="Search by name"
                />
              </label>
            </div>
          </div>

          <div className="summary-cards">
            <div className="summary-card in">
              <h3>Revenue</h3>
              <div className="value">{money(salesTotals.revenue)}</div>
            </div>
            <div className="summary-card net">
              <h3>Discount Given</h3>
              <div className="value">{money(salesTotals.discount)}</div>
            </div>
            <div className="summary-card net">
              <h3>Tax Collected</h3>
              <div className="value">{money(salesTotals.tax)}</div>
            </div>
            <div className="summary-card out">
              <h3>Outstanding</h3>
              <div className="value">{money(salesTotals.outstanding)}</div>
            </div>
          </div>

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{filteredSales.length} order(s)</h3>
              <button className="small secondary" onClick={exportSales} disabled={filteredSales.length === 0}>
                Export CSV
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{o.customerName}</td>
                    <td>{new Date(o.date).toLocaleString()}</td>
                    <td>{money(o.total)}</td>
                    <td>{o.paymentMethod}</td>
                    <td>{o.status}</td>
                  </tr>
                ))}
                {filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">No orders match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && tab === 'purchases' && (
        <>
          <div className="panel">
            <h3>Filters</h3>
            <div className="form-row">
              <label>
                From
                <input
                  type="date"
                  value={purchaseFilters.from}
                  onChange={(e) => setPurchaseFilters({ ...purchaseFilters, from: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={purchaseFilters.to}
                  onChange={(e) => setPurchaseFilters({ ...purchaseFilters, to: e.target.value })}
                />
              </label>
              <label>
                Payment method
                <select
                  value={purchaseFilters.paymentMethod}
                  onChange={(e) => setPurchaseFilters({ ...purchaseFilters, paymentMethod: e.target.value })}
                >
                  <option value="">All</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="credit">Credit</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={purchaseFilters.status}
                  onChange={(e) => setPurchaseFilters({ ...purchaseFilters, status: e.target.value })}
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="received">Received</option>
                  <option value="canceled">Canceled</option>
                </select>
              </label>
              <label>
                Supplier
                <input
                  value={purchaseFilters.supplierName}
                  onChange={(e) => setPurchaseFilters({ ...purchaseFilters, supplierName: e.target.value })}
                  placeholder="Search by name"
                />
              </label>
            </div>
          </div>

          <div className="summary-cards">
            <div className="summary-card out">
              <h3>Spend</h3>
              <div className="value">{money(purchaseTotals.spend)}</div>
            </div>
            <div className="summary-card net">
              <h3>Discount Received</h3>
              <div className="value">{money(purchaseTotals.discount)}</div>
            </div>
            <div className="summary-card net">
              <h3>Tax Paid</h3>
              <div className="value">{money(purchaseTotals.tax)}</div>
            </div>
            <div className="summary-card out">
              <h3>Outstanding</h3>
              <div className="value">{money(purchaseTotals.outstanding)}</div>
            </div>
          </div>

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{filteredPurchases.length} order(s)</h3>
              <button className="small secondary" onClick={exportPurchases} disabled={filteredPurchases.length === 0}>
                Export CSV
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{o.supplierName}</td>
                    <td>{new Date(o.date).toLocaleString()}</td>
                    <td>{money(o.total)}</td>
                    <td>{o.paymentMethod}</td>
                    <td>{o.status}</td>
                  </tr>
                ))}
                {filteredPurchases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">No orders match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && tab === 'inventory' && (
        <>
          <div className="panel">
            <h3>Filters</h3>
            <div className="form-row">
              <label>
                Category
                <select
                  value={inventoryFilters.category}
                  onChange={(e) => setInventoryFilters({ ...inventoryFilters, category: e.target.value })}
                >
                  <option value="">All</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={inventoryFilters.lowStockOnly}
                  onChange={(e) => setInventoryFilters({ ...inventoryFilters, lowStockOnly: e.target.checked })}
                  style={{ marginRight: '0.4rem' }}
                />
                Low stock only
              </label>
            </div>
          </div>

          <div className="summary-cards">
            <div className="summary-card net">
              <h3>SKUs</h3>
              <div className="value">{filteredInventory.length}</div>
            </div>
            <div className="summary-card net">
              <h3>Total Units</h3>
              <div className="value">{inventoryTotals.units}</div>
            </div>
            <div className="summary-card in">
              <h3>Inventory Value</h3>
              <div className="value">{money(inventoryTotals.value)}</div>
            </div>
          </div>

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{filteredInventory.length} product(s)</h3>
              <button className="small secondary" onClick={exportInventory} disabled={filteredInventory.length === 0}>
                Export CSV
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((i) => (
                  <tr key={i.id} className={i.isLowStock ? 'low-stock' : ''}>
                    <td>{i.sku}</td>
                    <td>{i.name}</td>
                    <td>{i.category}</td>
                    <td>{i.quantity}</td>
                    <td>{money(i.unitPrice)}</td>
                    <td>{money(i.quantity * i.unitPrice)}</td>
                    <td>{i.isLowStock ? <span className="badge danger">LOW</span> : <span className="badge ok">OK</span>}</td>
                  </tr>
                ))}
                {filteredInventory.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">No products match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && tab === 'receivables' && (
        <>
          <div className="panel">
            <h3>Filters</h3>
            <div className="form-row">
              <label>
                Customer
                <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search by name" />
              </label>
            </div>
          </div>

          <div className="summary-cards">
            <div className="summary-card out">
              <h3>Total Outstanding</h3>
              <div className="value">{money(totalReceivable)}</div>
            </div>
            <div className="summary-card net">
              <h3>Customers with a Balance</h3>
              <div className="value">{customerBalances.length}</div>
            </div>
          </div>

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{customerBalances.length} customer(s) owe money</h3>
              <button className="small secondary" onClick={exportReceivables} disabled={customerBalances.length === 0}>
                Export CSV
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Orders Outstanding</th>
                  <th>Total Owed</th>
                  <th>Outstanding Since</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customerBalances.map((c) => (
                  <Fragment key={c.customerName}>
                    <tr>
                      <td>{c.customerName}</td>
                      <td>{c.orderCount}</td>
                      <td>{money(c.totalDue)}</td>
                      <td>{new Date(c.oldestDate).toLocaleDateString()}</td>
                      <td>
                        <button
                          className="small secondary"
                          onClick={() => setExpandedCustomer(expandedCustomer === c.customerName ? null : c.customerName)}
                        >
                          {expandedCustomer === c.customerName ? 'Hide' : 'View orders'}
                        </button>
                      </td>
                    </tr>
                    {expandedCustomer === c.customerName && (
                      <tr>
                        <td colSpan={5}>
                          <div className="inline-panel">
                            <table>
                              <thead>
                                <tr>
                                  <th>Order ID</th>
                                  <th>Date</th>
                                  <th>Payment Method</th>
                                  <th>Total</th>
                                  <th>Amount Due</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.orders.map((o) => (
                                  <tr key={o.id}>
                                    <td>{o.id}</td>
                                    <td>{new Date(o.date).toLocaleString()}</td>
                                    <td>{o.paymentMethod}</td>
                                    <td>{money(o.total)}</td>
                                    <td>{money(o.amountDue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {customerBalances.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No outstanding balances right now.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
