import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isThisMonth(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function Dashboard() {
  const [inventory, setInventory] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
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
    })();
  }, []);

  const activeSales = salesOrders.filter((o) => o.status !== 'canceled');
  const todaySales = activeSales.filter((o) => isToday(o.date)).reduce((s, o) => s + Number(o.total), 0);
  const monthSales = activeSales.filter((o) => isThisMonth(o.date)).reduce((s, o) => s + Number(o.total), 0);

  const receivedPurchases = purchaseOrders.filter((o) => o.status === 'received');
  const monthPurchases = receivedPurchases
    .filter((o) => isThisMonth(o.receivedAt || o.date))
    .reduce((s, o) => s + Number(o.total), 0);

  const outstandingReceivable = activeSales.reduce((s, o) => s + Number(o.amountDue || 0), 0);
  const outstandingPayable = receivedPurchases.reduce((s, o) => s + Number(o.amountDue || 0), 0);

  const lowStockItems = inventory.filter((i) => i.isLowStock);
  const pendingPurchaseOrders = purchaseOrders.filter((o) => o.status === 'pending');
  const inventoryValue = inventory.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);

  const productTotals = new Map();
  for (const o of activeSales) {
    for (const li of o.items) {
      const soldQty = Number(li.qty) - Number(li.returnedQty || 0);
      if (soldQty <= 0) continue;
      const entry = productTotals.get(li.productId) || { name: li.name, qty: 0, revenue: 0 };
      entry.qty += soldQty;
      entry.revenue += soldQty * Number(li.unitPrice) * (1 - Number(li.discountPercent || 0) / 100);
      productTotals.set(li.productId, entry);
    }
  }
  const topProducts = [...productTotals.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

  return (
    <div className="page">
      <h2>Dashboard</h2>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="summary-cards">
            <div className="summary-card in">
              <h3>Today's Sales</h3>
              <div className="value">{money(todaySales)}</div>
            </div>
            <div className="summary-card in">
              <h3>This Month's Sales</h3>
              <div className="value">{money(monthSales)}</div>
            </div>
            <div className="summary-card out">
              <h3>This Month's Purchases</h3>
              <div className="value">{money(monthPurchases)}</div>
            </div>
            <div className="summary-card net">
              <h3>Inventory Value</h3>
              <div className="value">{money(inventoryValue)}</div>
            </div>
          </div>

          <div className="summary-cards">
            <div className="summary-card out">
              <h3>Receivable (owed to you)</h3>
              <div className="value">{money(outstandingReceivable)}</div>
            </div>
            <div className="summary-card out">
              <h3>Payable (you owe)</h3>
              <div className="value">{money(outstandingPayable)}</div>
            </div>
            <div className="summary-card net">
              <h3>Low Stock Items</h3>
              <div className="value">{lowStockItems.length}</div>
            </div>
            <div className="summary-card net">
              <h3>Pending Purchase Orders</h3>
              <div className="value">{pendingPurchaseOrders.length}</div>
            </div>
          </div>

          <div className="panel">
            <h3>Low Stock Items</h3>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Quantity</th>
                  <th>Threshold</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((i) => (
                  <tr key={i.id} className="low-stock">
                    <td>{i.sku}</td>
                    <td>{i.name}</td>
                    <td>{i.quantity}</td>
                    <td>{i.lowStockThreshold}</td>
                  </tr>
                ))}
                {lowStockItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">Nothing is low on stock right now.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Restock these from the <Link to="/purchase-orders">Purchase Orders</Link> tab.
            </p>
          </div>

          <div className="panel">
            <h3>Top Selling Products</h3>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.qty}</td>
                    <td>{money(p.revenue)}</td>
                  </tr>
                ))}
                {topProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">No sales yet.</td>
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
