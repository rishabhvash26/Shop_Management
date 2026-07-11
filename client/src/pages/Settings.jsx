import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { INDIAN_STATES } from '../indianStates.js';

const emptyForm = {
  businessName: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  gstRegistered: false,
  gstin: '',
};

export default function Settings() {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await api.getSettings();
      setForm({
        businessName: data.businessName || '',
        address: data.address || '',
        city: data.city || '',
        state: data.state || '',
        pincode: data.pincode || '',
        gstRegistered: Boolean(data.gstRegistered),
        gstin: data.gstin || '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleChange(field, value) {
    setForm({ ...form, [field]: value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.updateSettings(form);
      setSuccess('Settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <h2>Settings</h2>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="panel">
        <h3>Shop Profile {loading && <span className="muted">(loading...)</span>}</h3>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          This is your business's own registered details. They're printed on GST tax invoices and
          used to decide whether a sale is intra-state (CGST + SGST) or inter-state (IGST), based on
          your state vs. the customer's state.
        </p>
        <form className="stack" onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
          <label>
            Business name
            <input value={form.businessName} onChange={(e) => handleChange('businessName', e.target.value)} />
          </label>
          <label>
            Address
            <input value={form.address} onChange={(e) => handleChange('address', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              City
              <input value={form.city} onChange={(e) => handleChange('city', e.target.value)} />
            </label>
            <label>
              Pincode
              <input value={form.pincode} onChange={(e) => handleChange('pincode', e.target.value)} />
            </label>
          </div>
          <label>
            State
            <select value={form.state} onChange={(e) => handleChange('state', e.target.value)}>
              <option value="">Select state...</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.gstRegistered}
              onChange={(e) => handleChange('gstRegistered', e.target.checked)}
              style={{ marginRight: '0.4rem' }}
            />
            GST-registered
          </label>

          {form.gstRegistered && (
            <label>
              GSTIN
              <input
                value={form.gstin}
                onChange={(e) => handleChange('gstin', e.target.value.toUpperCase())}
                placeholder="e.g. 27AAAAA0000A1Z5"
                maxLength={15}
              />
            </label>
          )}

          {!form.gstRegistered && (
            <p className="muted">
              GST invoicing is unavailable until you turn this on and add a valid GSTIN — orders will
              only offer the Non-GST (Bill of Supply) option.
            </p>
          )}

          <div>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
