import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';
import EmployeeSearchSelect from '../common/EmployeeSearchSelect';

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const CURRENCIES = [
  { code: 'USD', symbol: '$', color: '#479c73' },
  { code: 'GEL', symbol: '₾', color: '#92400e' },
  { code: 'EUR', symbol: '€', color: '#7c3aed' },
];

const INPUT = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--border-2)', background: 'var(--surface-2)',
  color: 'var(--text)', fontSize: 13, boxSizing: 'border-box', outline: 'none',
};

const LABEL = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text-3)', marginBottom: 5,
};

const monthLastDay = (() => {
  const [y, m] = currentMonth.split('-');
  const last = new Date(Number(y), Number(m), 0).getDate();
  return `${currentMonth}-${String(last).padStart(2, '0')}`;
})();

const monthLabel = (() => {
  const [y, m] = currentMonth.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
})();

const EMPTY_FORM = {
  employeeId: '', type: 'OT', amount: '', otRate: '110',
  otHours: '', currency: '', includeInSalary: true, date: monthLastDay, autoDate: true,
};

export default function QuickUnitModal({ onClose, preselectedType }) {
  const { t } = useLanguage();
  const [step, setStep] = useState(preselectedType ? 2 : 1);

  const [unitTypes, setUnitTypes] = useState([]);
  const [overtimeRates, setOvertimeRates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [gelRate, setGelRate] = useState(null);
  const [eurRate, setEurRate] = useState(null);

  const [form, setForm] = useState({
    ...EMPTY_FORM,
    type: preselectedType?.name || 'OT',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const overlayRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [empRes, unitRes, otRes] = await Promise.all([
        api.get('/employees'),
        api.get('/units'),
        api.get('/overtime-rates'),
      ]);
      const emps = empRes.data.employees || [];
      const types = unitRes.data.unit_types || [];
      const rates = otRes.data.overtime_rates || [];
      setEmployees(emps);
      setUnitTypes(types);
      setOvertimeRates(rates);
      setForm(prev => ({
        ...prev,
        employeeId: prev.employeeId || (emps[0]?.id || ''),
        otRate: prev.otRate || (rates[0] ? String(rates[0].rate) : '110'),
      }));
    } catch {}
  }, []);

  useEffect(() => {
    load();
    api.get('/salaries', { params: { month: currentMonth } })
      .then(r => setSalaries(r.data.salaries || [])).catch(() => {});
    fetch('https://api.exchangerate-api.com/v4/latest/USD')
      .then(r => r.json())
      .then(d => { if (d.rates?.GEL) setGelRate(d.rates.GEL); if (d.rates?.EUR) setEurRate(d.rates.EUR); })
      .catch(() => {});
  }, [load]);

  const toUSD = (amount, currency) => {
    const val = parseFloat(amount);
    if (currency === 'GEL' && gelRate) return Math.round((val / gelRate) * 100) / 100;
    if (currency === 'EUR' && eurRate) return Math.round((val / eurRate) * 100) / 100;
    return val;
  };

  const getDirection = (type) => {
    if (type === 'OT' || type === 'Overtime' || type === 'Bonus') return 'addition';
    return unitTypes.find(u => u.name === type)?.direction || 'deduction';
  };

  const getWorkingDays = (empId) => salaries.find(s => s.employee?.id === empId)?.total_days || 22;
  const getEmpSalary = (empId) => parseFloat(salaries.find(s => s.employee?.id === empId)?.employee?.salary || 0);

  const calcOtAmount = (empId, rate, hours) => {
    const wdays = getWorkingDays(empId);
    const salary = getEmpSalary(empId);
    if (!salary || !hours || !rate) return '';
    const hr = salary / (wdays * 8);
    return (hr * (parseFloat(rate) / 100) * parseFloat(hours)).toFixed(2);
  };

  const isOT = form.type === 'OT' || form.type === 'Overtime';

  const pickUnit = (ut) => {
    setForm(prev => ({ ...prev, type: ut.name, amount: '', otHours: '' }));
    setStep(2);
    setError('');
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.employeeId || !form.amount || !form.currency) return;
    setSaving(true); setError('');
    try {
      const amountUSD = toUSD(form.amount, form.currency);
      const effectiveDate = form.autoDate ? monthLastDay : (form.date || monthLastDay);
      await api.post(`/employees/${form.employeeId}/units`, {
        type: form.type,
        amount: amountUSD,
        date: effectiveDate,
        currency: 'USD',
        include_in_salary: form.includeInSalary,
      });
      if (!form.includeInSalary) {
        const emp = employees.find(e => e.id === form.employeeId);
        const empName = emp ? `${emp.first_name} ${emp.last_name}` : '';
        await api.post('/accounting/transfers', {
          client_name: empName, agent_id: null, amount: amountUSD,
          due_date: effectiveDate,
          description: `${form.type} — ${empName}`, status: 'normal',
        }).catch(() => {});
      }
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add order.');
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e) => { if (e.target === overlayRef.current) onClose(); };

  const direction = getDirection(form.type);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 1000, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 520,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)', border: '1px solid var(--border-2)', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--surface-2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 2 && (
              <button
                onClick={() => { setStep(1); setError(''); setSuccess(false); }}
                style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                {step === 1 ? t('quick.selectUnit') : t('orders.newOrder')}
              </div>
              {step === 2 && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{monthLabel}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Step 1 — unit type grid */}
        {step === 1 && (
          <div className="qum-unit-grid">
            {unitTypes.length === 0 && (
              <div className="qum-empty">{t('quick.noUnits')}</div>
            )}
            {unitTypes.map(ut => (
              <button
                key={ut.id}
                className="qum-unit-card"
                style={{ '--ut-color': ut.direction === 'addition' ? '#479c73' : '#ef4444' }}
                onClick={() => pickUnit(ut)}
              >
                <span className="qum-unit-name">{ut.name}</span>
                <span className="qum-unit-dir">{ut.direction === 'addition' ? '+' : '−'}</span>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — New Order form (identical to Orders.js modal) */}
        {step === 2 && (
          <form onSubmit={handleAdd} style={{ padding: 24 }}>
            {error && (
              <div style={{ padding: '9px 14px', background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ padding: '9px 14px', background: 'rgba(71,156,115,0.12)', color: '#479c73', border: '1px solid rgba(71,156,115,0.25)', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                ✓ {t('quick.saved')}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>

              {/* Employee */}
              <div>
                <label style={LABEL}>{t('orders.employee')} *</label>
                <EmployeeSearchSelect employees={employees} value={form.employeeId} required placeholder={t('orders.selectEmployee')} onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))} />
              </div>

              {/* Order Type */}
              <div>
                <label style={LABEL}>{t('orders.orderType')}</label>
                <select
                  value={form.type}
                  onChange={e => setForm(p => ({ ...p, type: e.target.value, amount: '', otHours: '' }))}
                  required style={INPUT}
                >
                  <option value="OT">OT — Overtime (+)</option>
                  {unitTypes.map(ut => (
                    <option key={ut.id} value={ut.name}>{ut.name} ({ut.direction === 'addition' ? '+' : '−'})</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, marginTop: 5, color: direction === 'addition' ? '#479c73' : '#f87171' }}>
                  {direction === 'addition' ? t('orders.addedToNet') : t('orders.deductedFromNet')}
                </div>
              </div>

              {/* Date this should be transferred */}
              <div>
                <label style={LABEL}>{t('orders.transferDate')}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                  <input
                    type="checkbox"
                    checked={form.autoDate}
                    onChange={e => setForm(p => ({ ...p, autoDate: e.target.checked }))}
                    style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                  />
                  {t('orders.nearestTransferDate')} · {new Date(monthLastDay).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </label>
                {!form.autoDate && (
                  <input
                    type="date"
                    value={form.date || monthLastDay}
                    onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    style={{ ...INPUT, marginTop: 8 }}
                  />
                )}
              </div>

              {/* OT extras */}
              {isOT && (
                <>
                  <div>
                    <label style={LABEL}>{t('orders.otRate')}</label>
                    <select
                      value={form.otRate}
                      onChange={e => {
                        const rate = e.target.value;
                        setForm(p => ({ ...p, otRate: rate, amount: calcOtAmount(p.employeeId, rate, p.otHours) }));
                      }}
                      style={INPUT}
                    >
                      {overtimeRates.length > 0
                        ? overtimeRates.map(r => <option key={r.id} value={String(r.rate)}>{r.label} ({r.rate}%)</option>)
                        : <><option value="110">110%</option><option value="200">200%</option></>
                      }
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>{t('orders.otHours')}</label>
                    <input
                      type="number" min="0" step="0.5" placeholder="e.g. 8"
                      value={form.otHours}
                      onChange={e => {
                        const hours = e.target.value;
                        setForm(p => ({ ...p, otHours: hours, amount: calcOtAmount(p.employeeId, p.otRate, hours) }));
                      }}
                      style={INPUT}
                    />
                  </div>
                </>
              )}

              {/* Amount */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={LABEL}>
                  {t('orders.amount')} *
                  {form.currency && form.currency !== 'USD' && form.amount
                    ? <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>≈ ${toUSD(form.amount, form.currency)}</span>
                    : null}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number" step="0.01" min="0" placeholder="e.g. 150.00"
                    value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    required style={{ ...INPUT, flex: 1 }}
                  />
                  <select
                    value={form.currency}
                    onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
                    required style={{ ...INPUT, width: 110, flexShrink: 0 }}
                  >
                    <option value="">— Currency —</option>
                    {CURRENCIES.map(({ code, symbol }) => <option key={code} value={code}>{symbol} {code}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Include in salary toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, padding: '12px 14px', borderRadius: 9, border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('orders.includeInSalary')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {form.includeInSalary ? t('orders.willAffect') : t('orders.willNotAffect')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, includeInSalary: !p.includeInSalary }))}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: form.includeInSalary ? '#479c73' : 'var(--border-2)',
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: form.includeInSalary ? 22 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', display: 'block',
                }} />
              </button>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose}
                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {t('orders.cancel')}
              </button>
              <button type="submit" disabled={saving || success || !form.amount || !form.employeeId || !form.currency}
                style={{
                  padding: '9px 24px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
                  background: saving || success || !form.amount || !form.employeeId || !form.currency ? 'var(--surface-2)' : 'var(--accent, #3b82f6)',
                  color: saving || success || !form.amount || !form.employeeId || !form.currency ? 'var(--text-3)' : '#fff',
                  cursor: saving || success || !form.amount || !form.employeeId || !form.currency ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                }}>
                {saving ? (
                  <>
                    <svg style={{ animation: 'spin 0.8s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="40" strokeDashoffset="15"/></svg>
                    {t('orders.saving')}
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {t('orders.save')}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
