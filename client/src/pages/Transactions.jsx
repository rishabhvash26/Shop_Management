import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ totalIn: 0, totalOut: 0, net: 0 });
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState('cash_out');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  async function load(filterDate) {
    try {
      setLoading(true);
      const data = await api.getTransactions(filterDate || undefined);
      setTransactions(data.transactions);
      setSummary(data.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilter(e) {
    const value = e.target.value;
    setDate(value);
    load(value);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.createTransaction({ type, amount: Number(amount), note });
      setSuccess('Transaction recorded.');
      setAmount('');
      setNote('');
      load(date);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h2>Daily Transactions</h2>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="summary-cards">
        <div className="summary-card in">
          <h3>Total In</h3>
          <div className="value">${summary.totalIn.toFixed(2)}</div>
        </div>
        <div className="summary-card out">
          <h3>Total Out</h3>
          <div className="value">${summary.totalOut.toFixed(2)}</div>
        </div>
        <div className="summary-card net">
          <h3>Net</h3>
          <div className="value">${summary.net.toFixed(2)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Record manual transaction</h3>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              Type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="cash_in">Cash In</option>
                <option value="cash_out">Cash Out</option>
              </select>
            </label>
            <label>
              Amount
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
          </div>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Rent, misc expense" />
          </label>
          <div>
            <button type="submit">Add Transaction</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Transactions {loading && <span className="muted">(loading...)</span>}</h3>
          <label>
            Filter by date
            <input type="date" value={date} onChange={handleFilter} />
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.date).toLocaleString()}</td>
                <td>
                  <span className={`badge ${t.type === 'cash_in' ? 'ok' : 'danger'}`}>
                    {t.type === 'cash_in' ? 'Cash In' : 'Cash Out'}
                  </span>
                </td>
                <td>${Number(t.amount).toFixed(2)}</td>
                <td>{t.note}</td>
              </tr>
            ))}
            {transactions.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="muted">No transactions found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
