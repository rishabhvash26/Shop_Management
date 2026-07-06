// Thin fetch wrapper for the Express REST API.
// The Vite dev server proxies /api/* to http://localhost:4000.

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    // no JSON body
  }
  if (!res.ok) {
    const message = (body && body.error) || `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export const api = {
  // Inventory
  getInventory: () => request('/inventory'),
  createInventoryItem: (data) => request('/inventory', { method: 'POST', body: JSON.stringify(data) }),
  updateInventoryItem: (id, data) => request(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInventoryItem: (id) => request(`/inventory/${id}`, { method: 'DELETE' }),

  // Sales Orders
  getSalesOrders: () => request('/sales-orders'),
  getSalesOrder: (id) => request(`/sales-orders/${id}`),
  createSalesOrder: (data) => request('/sales-orders', { method: 'POST', body: JSON.stringify(data) }),
  renameSalesOrderCustomer: (id, data) => request(`/sales-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  editSalesOrder: (id, data) => request(`/sales-orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  returnSalesOrderItems: (id, data) => request(`/sales-orders/${id}/return`, { method: 'POST', body: JSON.stringify(data) }),
  cancelSalesOrder: (id) => request(`/sales-orders/${id}/cancel`, { method: 'POST' }),
  paySalesOrder: (id, data) => request(`/sales-orders/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),

  // Purchase Orders
  getPurchaseOrders: () => request('/purchase-orders'),
  createPurchaseOrder: (data) => request('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  editPurchaseOrder: (id, data) => request(`/purchase-orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  cancelPurchaseOrder: (id) => request(`/purchase-orders/${id}/cancel`, { method: 'POST' }),
  receivePurchaseOrder: (id) => request(`/purchase-orders/${id}/receive`, { method: 'PATCH' }),
  payPurchaseOrder: (id, data) => request(`/purchase-orders/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),

  // Transactions
  getTransactions: (date) => request(`/transactions${date ? `?date=${date}` : ''}`),
  createTransaction: (data) => request('/transactions', { method: 'POST', body: JSON.stringify(data) }),
};
