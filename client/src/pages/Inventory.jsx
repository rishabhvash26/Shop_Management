import { useEffect, useState } from 'react';
import { api } from '../api.js';

const emptyForm = { sku: '', name: '', category: '', quantity: '', unitPrice: '', lowStockThreshold: '' };

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  async function load() {
    try {
      setLoading(true);
      const data = await api.getInventory();
      setItems(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.createInventoryItem({
        sku: form.sku,
        name: form.name,
        category: form.category,
        quantity: Number(form.quantity),
        unitPrice: Number(form.unitPrice),
        lowStockThreshold: Number(form.lowStockThreshold),
      });
      setForm(emptyForm);
      setSuccess(`Added "${form.name}" to inventory.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete "${name}" from inventory?`)) return;
    setError('');
    try {
      await api.deleteInventoryItem(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(item) {
    setError('');
    setSuccess('');
    setEditingId(item.id);
    setEditForm({
      sku: item.sku,
      name: item.name,
      category: item.category || '',
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      lowStockThreshold: String(item.lowStockThreshold),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm);
  }

  function handleEditChange(e) {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  }

  async function handleEditSubmit(e, id) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.updateInventoryItem(id, {
        sku: editForm.sku,
        name: editForm.name,
        category: editForm.category,
        quantity: Number(editForm.quantity),
        unitPrice: Number(editForm.unitPrice),
        lowStockThreshold: Number(editForm.lowStockThreshold),
      });
      setSuccess(`Updated "${editForm.name}".`);
      setEditingId(null);
      setEditForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h2>Inventory</h2>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="panel">
        <h3>Add product</h3>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              SKU
              <input name="sku" value={form.sku} onChange={handleChange} required />
            </label>
            <label>
              Name
              <input name="name" value={form.name} onChange={handleChange} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Category
              <input name="category" value={form.category} onChange={handleChange} />
            </label>
            <label>
              Quantity
              <input name="quantity" type="number" min="0" value={form.quantity} onChange={handleChange} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Unit price
              <input name="unitPrice" type="number" min="0" step="0.01" value={form.unitPrice} onChange={handleChange} required />
            </label>
            <label>
              Low stock threshold
              <input name="lowStockThreshold" type="number" min="0" value={form.lowStockThreshold} onChange={handleChange} required />
            </label>
          </div>
          <div>
            <button type="submit">Add Product</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h3>Products {loading && <span className="muted">(loading...)</span>}</h3>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Low Stock Threshold</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              editingId === item.id ? (
                <tr key={item.id} className={item.isLowStock ? 'low-stock' : ''}>
                  <td colSpan={8}>
                    <form className="form-row" onSubmit={(e) => handleEditSubmit(e, item.id)}>
                      <input name="sku" value={editForm.sku} onChange={handleEditChange} required />
                      <input name="name" value={editForm.name} onChange={handleEditChange} required />
                      <input name="category" value={editForm.category} onChange={handleEditChange} />
                      <input
                        name="quantity"
                        type="number"
                        min="0"
                        value={editForm.quantity}
                        onChange={handleEditChange}
                        required
                      />
                      <input
                        name="unitPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.unitPrice}
                        onChange={handleEditChange}
                        required
                      />
                      <input
                        name="lowStockThreshold"
                        type="number"
                        min="0"
                        value={editForm.lowStockThreshold}
                        onChange={handleEditChange}
                        required
                      />
                      <button type="submit" className="small">
                        Save
                      </button>
                      <button type="button" className="small secondary" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className={item.isLowStock ? 'low-stock' : ''}>
                  <td>{item.sku}</td>
                  <td>{item.name}</td>
                  <td>{item.category}</td>
                  <td>{item.quantity}</td>
                  <td>${Number(item.unitPrice).toFixed(2)}</td>
                  <td>{item.lowStockThreshold}</td>
                  <td>
                    {item.isLowStock ? (
                      <span className="badge danger">LOW STOCK</span>
                    ) : (
                      <span className="badge ok">OK</span>
                    )}
                  </td>
                  <td>
                    <button className="small" onClick={() => startEdit(item)}>
                      Edit
                    </button>{' '}
                    <button className="small secondary" onClick={() => handleDelete(item.id, item.name)}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="muted">No products yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
