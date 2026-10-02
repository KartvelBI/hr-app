import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { generateOrderPDF, generatePromotionPDF } from '../../utils/generateOrderPDF';
import { HugeiconsIcon } from '@hugeicons/react';
import { UserIcon, Exchange01Icon, File01Icon, Agreement01Icon, Key01Icon } from '@hugeicons/core-free-icons';
import '../Employees/Employees.css';
import { useExcelTable, TableHeaderRow, ColumnVisibilityMenu, PaginationBar } from '../common/ExcelTable';
import TableSkeleton from '../common/TableSkeleton';

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// Net (take-home) <-> Accrued (gross) salary conversion.
// accrued = net / (1 - pitRate) / (1 - pensionRate)
function calcAccruedFromNet(net, pitRate, pensionOn) {
  const n = parseFloat(net);
  if (!n || n <= 0) return '';
  const pit = parseFloat(pitRate) || 0;
  const pensionRate = pensionOn ? 2 : 0;
  const gross = n / (1 - pit / 100) / (1 - pensionRate / 100);
  return Number.isFinite(gross) ? gross.toFixed(2) : '';
}
function calcNetFromAccrued(accrued, pitRate, pensionOn) {
  const g = parseFloat(accrued);
  if (!g || g <= 0) return '';
  const pit = parseFloat(pitRate) || 0;
  const pensionRate = pensionOn ? 2 : 0;
  const net = g * (1 - pit / 100) * (1 - pensionRate / 100);
  return Number.isFinite(net) ? net.toFixed(2) : '';
}

const CURRENCIES = [
  { code: 'USD', symbol: '$', color: '#479c73' },
  { code: 'GEL', symbol: '₾', color: '#92400e' },
  { code: 'EUR', symbol: '€', color: '#7c3aed' },
];

const INPUT = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--border-2)', background: 'var(--surface-2)',
  color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
  outline: 'none',
};

const LABEL = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text-3)', marginBottom: 5,
};

function fmt(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

// Shared "Export to Excel" for every Orders sub-tab: columns is
// [{ header: 'Name', get: row => value }], rows is the tab's order list.
function exportOrdersToExcel(rows, columns, sheetName, fileName) {
  const headers = columns.map(c => c.header);
  const data = (rows || []).map(r => columns.map(c => c.get(r)));
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = columns.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const EXPORT_BTN_STYLE = {
  display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9,
  border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-2)',
  fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 10,
};
function ExportExcelButton({ onClick }) {
  return (
    <button onClick={onClick} style={EXPORT_BTN_STYLE}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export to Excel
    </button>
  );
}

const ORDER_SUBTAB_KEYS = [
  { key: 'hiring',           labelKey: 'orders.hiring'          },
  { key: 'firing',           labelKey: 'orders.firing'          },
  { key: 'promotion',        labelKey: 'orders.promotion'       },
  { key: 'adjusting',        labelKey: 'orders.adjusting'       },
  { key: 'business-trip',    labelKey: 'orders.businessTrip'    },
  { key: 'advance-payment',  labelKey: 'orders.advancePayment'  },
  { key: 'handover',         labelKey: 'orders.handover'        },
  { key: 'bonus',            labelKey: 'orders.bonus'           },
];

// ── Shared helpers ───────────────────────────────────────────────────────────
const DEFAULT_ORDERS_MATRIX = [
  { role: 'Super Admin',         description: 'Full access to all orders',   create_hiring: 'Yes', create_firing: 'Yes', create_promotion: 'Yes', create_adjusting: 'Yes', create_business_trip: 'Yes', view_orders: 'Yes' },
  { role: 'Admin',               description: 'Can manage most orders',      create_hiring: 'Yes', create_firing: 'Yes', create_promotion: 'Yes', create_adjusting: 'Yes', create_business_trip: 'Yes', view_orders: 'Yes' },
  { role: 'Member',              description: 'Standard access',             create_hiring: 'No',  create_firing: 'No',  create_promotion: 'No',  create_adjusting: 'No',  create_business_trip: 'Yes', view_orders: 'Own only' },
];

function useOrdersPermissions() {
  const currentRights = (() => {
    try { const s = localStorage.getItem('member_user'); return s ? JSON.parse(s).rights : 'Super Admin'; } catch { return 'Super Admin'; }
  })();

  const [matrix, setMatrix] = useState(() => {
    try {
      const local = localStorage.getItem('orders_matrix');
      return local ? JSON.parse(local) : DEFAULT_ORDERS_MATRIX;
    } catch {
      return DEFAULT_ORDERS_MATRIX;
    }
  });

  useEffect(() => {
    const sync = () => {
      try {
        const local = localStorage.getItem('orders_matrix');
        setMatrix(local ? JSON.parse(local) : DEFAULT_ORDERS_MATRIX);
      } catch {}
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return matrix.find(r => r.role === currentRights) || DEFAULT_ORDERS_MATRIX.find(r => r.role === 'Member') || {};
}

// Local Orders (hiring/firing/promotion/etc.) used to be stored under a
// plain, un-namespaced localStorage key -- since localStorage is scoped per
// browser origin, not per logged-in company, any browser used to log into
// more than one organization would see every org's records bleed together.
// Namespace by the current tenant's id, and one-time-migrate any of THIS
// tenant's own records out of the old shared bucket (matched by employee id,
// via `isOwnedByCurrentTenant`) so switching to a namespaced key doesn't
// silently drop legitimate history while still excluding other orgs' data.
function useLocalOrders(key, isOwnedByCurrentTenant) {
  const { user } = useAuth();
  const namespacedKey = `${key}_${user?.id || 'anon'}`;

  const [orders, setOrders] = useState(() => {
    try {
      const existing = localStorage.getItem(namespacedKey);
      if (existing !== null) return JSON.parse(existing) || [];
      const legacy = JSON.parse(localStorage.getItem(key)) || [];
      const owned = isOwnedByCurrentTenant ? legacy.filter(isOwnedByCurrentTenant) : [];
      localStorage.setItem(namespacedKey, JSON.stringify(owned));
      return owned;
    } catch { return []; }
  });
  const save = (next) => { setOrders(next); localStorage.setItem(namespacedKey, JSON.stringify(next)); };
  const add = (row) => save([{ id: Date.now(), createdAt: new Date().toISOString(), createdBy: user?.name || user?.email || 'Unknown', ...row }, ...orders]);
  const update = (id, row) => save(orders.map(o => o.id === id ? { ...o, ...row } : o));
  const remove = (id) => save(orders.filter(o => o.id !== id));
  return { orders, add, update, remove };
}

function SubTabModal({ title, onClose, children, maxWidth = 520 }) {
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', border: '1px solid var(--border-2)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

function SubTabActions({ onSave, onCancel, saving, disabled }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
      <button type="button" onClick={onCancel} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{t('orders.cancel')}</button>
      <button type="submit" disabled={saving || disabled} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13, background: saving || disabled ? 'var(--surface-2)' : 'var(--accent,#3b82f6)', color: saving || disabled ? 'var(--text-3)' : '#fff', cursor: saving || disabled ? 'not-allowed' : 'pointer' }}>
        {saving ? t('orders.saving') : t('orders.save')}
      </button>
    </div>
  );
}

const endOfMonth = (monthStr) => {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).toISOString().split('T')[0];
};
const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function ImmediateEffectToggle({ value, onToggle }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={LABEL}>Effect Timing</label>
      <div style={{ display: 'inline-flex', borderRadius: 8, border: '1px solid var(--border-2)', overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => onToggle(true)}
          style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: value ? '#3b82f6' : 'var(--surface-2)', color: value ? '#fff' : 'var(--text-3)', transition: 'all 0.15s' }}
        >
          ⚡ Immediate Effect
        </button>
        <button
          type="button"
          onClick={() => onToggle(false)}
          style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderLeft: '1px solid var(--border-2)', cursor: 'pointer', fontFamily: 'inherit', background: !value ? '#3b82f6' : 'var(--surface-2)', color: !value ? '#fff' : 'var(--text-3)', transition: 'all 0.15s' }}
        >
          📅 End of month
        </button>
      </div>
    </div>
  );
}

// Searchable employee dropdown. Drop-in replacement for a native
// <select value=... onChange=...> employee picker — calls onChange with a
// synthetic { target: { value } } event so existing e.target.value handlers
// (including the `f(key)` helper used across this file) keep working unchanged.
function EmployeeSearchSelect({ employees, value, onChange, placeholder = 'Select employee…', excludeId, required }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const pool = excludeId ? employees.filter(e => String(e.id) !== String(excludeId)) : employees;
  const selected = pool.find(e => String(e.id) === String(value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? pool.filter(e => `${e.first_name} ${e.last_name}`.toLowerCase().includes(q))
    : pool;

  const pick = (id) => {
    onChange({ target: { value: id } });
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Hidden input carries HTML5 required validation without a visible native select */}
      {required && <input tabIndex={-1} value={value || ''} onChange={() => {}} required style={{ position: 'absolute', opacity: 0, height: 0, width: '100%', pointerEvents: 'none' }} />}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ ...INPUT, width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <span style={{ color: selected ? 'var(--text)' : 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? `${selected.first_name} ${selected.last_name}` : placeholder}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
          background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 9,
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 280,
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-2)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Search employee…"
              style={{ ...INPUT, padding: '6px 10px', fontSize: 13 }}
            />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {value && (
              <div
                onClick={() => pick('')}
                style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--text-3)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                — Clear selection —
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-4)', textAlign: 'center' }}>No matches</div>
            ) : filtered.map(e => {
              const isSel = String(value) === String(e.id);
              return (
                <div
                  key={e.id}
                  onClick={() => pick(e.id)}
                  style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontWeight: isSel ? 700 : 500, background: isSel ? 'var(--surface-2)' : 'transparent' }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = isSel ? 'var(--surface-2)' : 'transparent'}
                >
                  {e.first_name} {e.last_name}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ label, onAdd }) {
  const { t } = useLanguage();
  return (
    <div style={{ textAlign: 'center', padding: '64px 24px' }}>
      <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15, marginBottom: 6 }}>{t('orders.noOrders', { month: label })}</div>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>{t('orders.noOrdersHint')}</div>
      {onAdd && <button onClick={onAdd} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#479c73', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>+ {t('orders.addNew')}</button>}
    </div>
  );
}

// ── Promotion Tab ─────────────────────────────────────────────────────────────
function PromotionTab({ employees, registerAdd }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [positions, setPositions] = useState([]);
  const [pdfLoadingId, setPdfLoadingId] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const EMPTY = { employeeId: '', newPosition: '', oldSalary: '', newSalary: '', effectiveDate: '', notes: '', immediateEffect: true };

  const mapRecord = (r) => {
    const emp = employees.find(e => e.id === r.employee_id);
    return {
      id: r.id, employeeId: r.employee_id,
      empName: emp ? `${emp.first_name} ${emp.last_name}` : '',
      oldPosition: r.old_position, newPosition: r.new_position,
      oldSalary: r.old_salary, newSalary: r.new_salary,
      effectiveDate: r.effective_date, notes: r.notes || '',
      salaryChangeId: r.salary_change_id, createdAt: r.created_at,
    };
  };
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/promotions');
      setOrders((res.data.records || []).map(mapRecord));
    } catch { setOrders([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [employees]);

  const handleDownloadPDF = async (o, idx) => {
    setPdfLoadingId(o.id);
    try {
      await generatePromotionPDF({
        order: o,
        companyName: user?.user_metadata?.company_name || user?.email || 'Company',
        orderNumber: idx + 1,
      });
    } finally {
      setPdfLoadingId(null);
    }
  };
  const [form, setForm] = useState(EMPTY);
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    api.get('/positions').then(res => setPositions(res.data.positions || [])).catch(() => {});
  }, []);

  const perms = useOrdersPermissions();
  const canCreate = perms.create_promotion === 'Yes';

  const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); setError(''); };
  useEffect(() => { if (registerAdd) registerAdd.current = openAdd; });
  const openEdit = (o) => { setEditing(o.id); setForm({ employeeId: o.employeeId, newPosition: o.newPosition, oldSalary: o.oldSalary, newSalary: o.newSalary, effectiveDate: o.effectiveDate, notes: o.notes || '' }); setShowForm(true); setError(''); };
  const openCopy = (o) => { setEditing(null); setForm({ employeeId: o.employeeId, newPosition: o.newPosition, oldSalary: o.oldSalary, newSalary: o.newSalary, effectiveDate: o.effectiveDate, notes: o.notes || '' }); setShowForm(true); setError(''); };
  const close = () => { setShowForm(false); setEditing(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const emp = employees.find(x => x.id === form.employeeId);
    const oldPosition = emp?.position || '';
    setSaving(true);
    setError('');
    try {
      // Only a NEW promotion actually applies the change -- editing an
      // existing order's fields (e.g. fixing a typo in notes) doesn't
      // re-apply it, since the real salary/position change already happened.
      let salaryChangeId = editing ? orders.find(o => o.id === editing)?.salaryChangeId : null;
      if (!editing) {
        const res = await api.post(`/employees/${form.employeeId}/salary-changes`, {
          salary: form.newSalary,
          effective_date: form.effectiveDate,
          note: form.notes || null,
          position: form.newPosition || undefined,
        });
        salaryChangeId = res.data?.salary_change?.id || null;
      }
      const payload = {
        employee_id: form.employeeId, old_position: oldPosition, new_position: form.newPosition,
        old_salary: form.oldSalary || null, new_salary: form.newSalary,
        effective_date: form.effectiveDate, notes: form.notes || null,
        salary_change_id: salaryChangeId,
      };
      if (editing) await api.put(`/promotions/${editing}`, payload);
      else await api.post('/promotions', payload);
      close();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'ცვლილების შენახვა ვერ მოხერხდა.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (o) => {
    if (!window.confirm('წავშალოთ ეს დაწინაურების ბრძანება?')) return;
    if (o.salaryChangeId) {
      try { await api.delete(`/employees/${o.employeeId}/salary-changes/${o.salaryChangeId}`); } catch {}
    }
    try { await api.delete(`/promotions/${o.id}`); } catch {}
    await load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(orders, [
          { header: 'Date', get: o => o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '' },
          { header: 'Employee', get: o => o.empName || '' },
          { header: 'Old Position', get: o => o.oldPosition || '' },
          { header: 'New Position', get: o => o.newPosition || '' },
          { header: 'Old Salary', get: o => o.oldSalary || '' },
          { header: 'New Salary', get: o => o.newSalary || '' },
          { header: 'Effective Date', get: o => o.effectiveDate || '' },
          { header: 'Notes', get: o => o.notes || '' },
        ], 'Promotion', 'Promotion-Orders')} />}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>Loading…</div>
        ) : orders.length === 0 ? <EmptyState label={t('orders.promotion')} onAdd={canCreate ? openAdd : undefined} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {[t('orders.date'), t('orders.employee'), t('orders.oldPosition'), t('orders.newPosition'), t('orders.oldSalary'), t('orders.newSalary'), t('orders.effectiveDate'), t('orders.notes'), ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, idx) => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)', cursor: 'pointer' }} onClick={openRowMenu} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)' }}>{o.empName}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.oldPosition || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#479c73', fontWeight: 600 }}>{o.newPosition}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.oldSalary || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#479c73', fontWeight: 600 }}>{o.newSalary}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{o.effectiveDate ? new Date(o.effectiveDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes || '—'}</td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleDownloadPDF(o, idx)} disabled={pdfLoadingId === o.id} title="Download PDF"
                        style={{ ...actionBtn, color: pdfLoadingId === o.id ? 'var(--text-4)' : 'var(--text-3)' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          <line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/>
                        </svg>
                      </button>
                      <RowActionsMenu
                        t={t}
                        onCopy={() => openCopy(o)}
                        onEdit={() => openEdit(o)}
                        onDetails={() => setDetailsFor(o)}
                        onDelete={() => handleRemove(o)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {detailsFor && (
        <DetailsModal
          t={t}
          title={t('orders.promotion')}
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: t('orders.date'), value: new Date(detailsFor.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: t('orders.employee'), value: detailsFor.empName },
            { label: t('orders.oldPosition'), value: detailsFor.oldPosition },
            { label: t('orders.newPosition'), value: detailsFor.newPosition },
            { label: t('orders.oldSalary'), value: detailsFor.oldSalary },
            { label: t('orders.newSalary'), value: detailsFor.newSalary },
            { label: t('orders.effectiveDate'), value: detailsFor.effectiveDate ? new Date(detailsFor.effectiveDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null },
            { label: t('orders.notes'), value: detailsFor.notes },
          ]}
        />
      )}
      {showForm && (
        <SubTabModal title={editing ? t('orders.editPromotion') : t('orders.newPromotion')} onClose={close}>
          <form onSubmit={handleSubmit}>
            {error && <div className="msg-error" style={{ marginBottom: 14 }}>{error}</div>}
            <div style={{ display: 'grid', gap: 14 }}>
              <div><label style={LABEL}>{t('orders.employee')} *</label>
                <EmployeeSearchSelect employees={employees} value={form.employeeId} required placeholder={t('orders.selectEmployee')} onChange={e => {
                  const emp = employees.find(x => x.id === e.target.value);
                  setForm(p => ({ ...p, employeeId: e.target.value, oldSalary: emp?.salary ? String(emp.salary) : '' }));
                }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={LABEL}>{t('orders.oldPosition')}</label><input value={form.oldPosition || employees.find(e => e.id === form.employeeId)?.position || ''} readOnly style={{ ...INPUT, width: '100%', opacity: 0.6 }} /></div>
                <div><label style={LABEL}>{t('orders.newPosition')}</label>
                  <select value={form.newPosition} onChange={f('newPosition')} style={{ ...INPUT, width: '100%' }}>
                    <option value="">{t('orders.selectPosition')}</option>
                    {positions.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div><label style={LABEL}>{t('orders.oldSalary')}</label><input type="number" value={form.oldSalary} readOnly style={{ ...INPUT, width: '100%', opacity: 0.6 }} /></div>
                <div><label style={LABEL}>{t('orders.newSalary')} *</label><input type="number" value={form.newSalary} onChange={f('newSalary')} required style={{ ...INPUT, width: '100%' }} /></div>
              </div>
              <ImmediateEffectToggle value={form.immediateEffect} onToggle={v => setForm(p => ({ ...p, immediateEffect: v, effectiveDate: v ? p.effectiveDate : endOfMonth(currentMonthStr()) }))} />
              <div><label style={LABEL}>{t('orders.effectiveDate')} *</label><input type="date" value={form.effectiveDate} onChange={f('effectiveDate')} required style={{ ...INPUT, width: '100%' }} /></div>
              <div><label style={LABEL}>{t('orders.notes')}</label><input value={form.notes} onChange={f('notes')} style={{ ...INPUT, width: '100%' }} /></div>
            </div>
            <SubTabActions onCancel={close} saving={saving} disabled={!form.employeeId || !form.newSalary || !form.effectiveDate} />
          </form>
        </SubTabModal>
      )}
    </div>
  );
}

// ── Hiring Tab ────────────────────────────────────────────────────────────────
function HiringTab({ registerAdd }) {
  const { t } = useLanguage();
  const { orders, add, update, remove } = useLocalOrders('hr_hiring_orders');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState('info');
  const [positions, setPositions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const EMPTY = {
    firstName: '', lastName: '', personalId: '', birthdate: '',
    position: '', department: '', startDate: '', endDate: '',
    salary: '', salaryCurrency: '', accountNumber: '', pitRate: '20',
    pension: false, personalEmail: '', phone: '', address: '', notes: '',
    immediateEffect: true,
  };
  const [form, setForm] = useState(EMPTY);
  const [accruedInput, setAccruedInput] = useState('');
  const fv = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  // Salary / Accrued Salary are two views of the same number — editing either
  // one recalculates the other using the current PIT rate and pension state.
  const handleSalaryChange = (e) => {
    const value = e.target.value;
    setForm(prev => ({ ...prev, salary: value }));
    setAccruedInput(calcAccruedFromNet(value, form.pitRate, form.pension));
  };
  const handleAccruedChange = (e) => {
    const value = e.target.value;
    setAccruedInput(value);
    setForm(prev => ({ ...prev, salary: calcNetFromAccrued(value, form.pitRate, form.pension) }));
  };
  const handlePitRateChange = (e) => {
    const value = e.target.value;
    setForm(prev => ({ ...prev, pitRate: value }));
    setAccruedInput(calcAccruedFromNet(form.salary, value, form.pension));
  };
  const handlePensionToggle = () => {
    const next = !form.pension;
    setForm(prev => ({ ...prev, pension: next }));
    setAccruedInput(calcAccruedFromNet(form.salary, form.pitRate, next));
  };

  useEffect(() => {
    api.get('/positions').then(r => setPositions(r.data.positions || [])).catch(() => {});
    api.get('/departments').then(r => setDepartments(r.data.departments || [])).catch(() => {});
    api.get('/tax-codes').then(r => setTaxCodes(r.data.tax_codes || [])).catch(() => {});
  }, []);

  const TABS = [
    { key: 'info',      label: t('orders.employeeInfo'),   icon: UserIcon },
    { key: 'account',   label: t('orders.accountChanges'), icon: Exchange01Icon },
    { key: 'documents', label: t('orders.documents'),      icon: File01Icon },
    { key: 'agreement', label: t('orders.agreement'),      icon: Agreement01Icon },
    { key: 'portal',    label: t('orders.portalAccess'),   icon: Key01Icon },
  ];

  const perms = useOrdersPermissions();
  const canCreate = perms.create_hiring === 'Yes';

  const [detailsFor, setDetailsFor] = useState(null);
  const openAdd = () => { setEditing(null); setForm(EMPTY); setAccruedInput(''); setActiveTab('info'); setShowForm(true); };
  useEffect(() => { if (registerAdd) registerAdd.current = openAdd; });
  const openEdit = (o) => {
    setEditing(o.id);
    setForm({
      firstName: o.firstName || '', lastName: o.lastName || '',
      personalId: o.personalId || '', birthdate: o.birthdate || '',
      position: o.position || '', department: o.department || '',
      startDate: o.startDate || '', endDate: o.endDate || '',
      salary: o.salary || '', salaryCurrency: o.salaryCurrency || '', accountNumber: o.accountNumber || '',
      pitRate: o.pitRate || '20',
      pension: o.pension || false, personalEmail: o.personalEmail || '',
      phone: o.phone || '', address: o.address || '', notes: o.notes || '',
    });
    setAccruedInput(calcAccruedFromNet(o.salary, o.pitRate || '20', o.pension || false));
    setActiveTab('info');
    setShowForm(true);
  };
  const openCopy = (o) => {
    setEditing(null);
    setForm({
      firstName: o.firstName || '', lastName: o.lastName || '',
      personalId: '', birthdate: o.birthdate || '',
      position: o.position || '', department: o.department || '',
      startDate: o.startDate || '', endDate: o.endDate || '',
      salary: o.salary || '', salaryCurrency: o.salaryCurrency || '', accountNumber: '',
      pitRate: o.pitRate || '20',
      pension: o.pension || false, personalEmail: '',
      phone: '', address: o.address || '', notes: o.notes || '',
    });
    setAccruedInput(calcAccruedFromNet(o.salary, o.pitRate || '20', o.pension || false));
    setActiveTab('info');
    setShowForm(true);
  };
  const close = () => { setShowForm(false); setEditing(null); setSubmitError(''); };

  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.state?.openHire && canCreate) {
      openAdd();
      navigate(location.pathname + location.search, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!editing) {
      setSaving(true);
      try {
        const data = new FormData();
        data.append('first_name', form.firstName.trim());
        data.append('last_name', form.lastName.trim());
        data.append('personal_id', form.personalId.trim());
        data.append('birthdate', form.birthdate);
        data.append('position', form.position.trim());
        data.append('salary', form.salary);
        data.append('salary_currency', form.salaryCurrency || 'GEL');
        data.append('start_date', form.startDate);
        if (form.endDate) data.append('end_date', form.endDate);
        if (form.department) data.append('department', form.department.trim());
        if (form.accountNumber) data.append('account_number', form.accountNumber.trim());
        if (form.phone) data.append('mobile_number', form.phone.trim());
        if (form.personalEmail) data.append('personal_email', form.personalEmail.trim());
        data.append('pit_rate', form.pitRate || 20);
        data.append('pension', form.pension ? 'true' : 'false');
        await api.post('/employees', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      } catch (err) {
        setSubmitError(err.response?.data?.error || 'Failed to create employee.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    editing ? update(editing, form) : add(form);
    close();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(orders, [
          { header: 'Date', get: o => o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '' },
          { header: 'First Name', get: o => o.firstName || '' },
          { header: 'Last Name', get: o => o.lastName || '' },
          { header: 'Personal ID', get: o => o.personalId || '' },
          { header: 'Birthdate', get: o => o.birthdate || '' },
          { header: 'Position', get: o => o.position || '' },
          { header: 'Department', get: o => o.department || '' },
          { header: 'Start Date', get: o => o.startDate || '' },
          { header: 'Salary', get: o => o.salary || '' },
          { header: 'Currency', get: o => o.salaryCurrency || '' },
          { header: 'Account Number', get: o => o.accountNumber || '' },
          { header: 'PIT Rate', get: o => o.pitRate || '' },
          { header: 'Pension', get: o => o.pension ? 'Yes' : 'No' },
          { header: 'Email', get: o => o.personalEmail || '' },
          { header: 'Phone', get: o => o.phone || '' },
          { header: 'Address', get: o => o.address || '' },
          { header: 'Notes', get: o => o.notes || '' },
        ], 'Hiring', 'Hiring-Orders')} />}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {orders.length === 0 ? <EmptyState label={t('orders.hiring')} onAdd={canCreate ? openAdd : undefined} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {[t('orders.date'), t('orders.fullName'), t('orders.personalId'), t('orders.position'), t('orders.department'), t('orders.startDate'), t('orders.salary'), t('orders.notes'), ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)', cursor: 'pointer' }} onClick={openRowMenu} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)' }}>{o.firstName} {o.lastName}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.personalId || '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text)' }}>{o.position}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.department || '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{o.startDate ? new Date(o.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#479c73', fontWeight: 600 }}>{o.salary}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes || '—'}</td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <RowActionsMenu
                        t={t}
                        onCopy={() => openCopy(o)}
                        onEdit={() => openEdit(o)}
                        onDetails={() => setDetailsFor(o)}
                        onDelete={() => remove(o.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detailsFor && (
        <DetailsModal
          t={t}
          title={t('orders.hiring')}
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: t('orders.date'), value: new Date(detailsFor.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: t('orders.fullName'), value: `${detailsFor.firstName || ''} ${detailsFor.lastName || ''}`.trim() },
            { label: t('orders.personalId'), value: detailsFor.personalId },
            { label: t('orders.position'), value: detailsFor.position },
            { label: t('orders.department'), value: detailsFor.department },
            { label: t('orders.startDate'), value: detailsFor.startDate ? new Date(detailsFor.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null },
            { label: t('orders.salary'), value: detailsFor.salary ? `${detailsFor.salary} ${detailsFor.salaryCurrency || ''}`.trim() : null },
            { label: t('orders.notes'), value: detailsFor.notes },
          ]}
        />
      )}

      {/* Modal overlay */}
      {showForm && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) close(); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
        <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 1180, maxHeight: '90vh', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', border: '1px solid var(--border-2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div className="emp-header" style={{ padding: '14px 24px', borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)', marginBottom: 0 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{editing ? t('orders.editHiringOrder') : t('orders.newHiringOrder')}</h1>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>{t('orders.enterDetails')}</p>
            </div>
            <button onClick={close} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>

          {/* Horizontal tab bar */}
          <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid var(--border-2)', background: 'var(--surface)' }}>
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 4px', marginRight: 18, fontSize: 13, fontWeight: 600,
                  color: activeTab === tab.key ? 'var(--text)' : 'var(--text-3)',
                  borderBottom: activeTab === tab.key ? '2px solid var(--accent, #3b82f6)' : '2px solid transparent',
                  transition: 'color 0.12s, border-color 0.12s',
                }}
              >
                <HugeiconsIcon icon={tab.icon} size={16} color={activeTab === tab.key ? 'var(--accent, #3b82f6)' : 'currentColor'} strokeWidth={2} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {activeTab === 'info' && (
                <div className="form-card">
                  <form onSubmit={handleSubmit}>
                    {submitError && (
                      <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.1)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                        {submitError}
                      </div>
                    )}
                    <div className="form-grid-4">
                      <div className="form-group">
                        <label>{t('orders.firstName')} *</label>
                        <input value={form.firstName} onChange={fv('firstName')} placeholder="John" required />
                      </div>
                      <div className="form-group">
                        <label>{t('orders.lastName')} *</label>
                        <input value={form.lastName} onChange={fv('lastName')} placeholder="Doe" required />
                      </div>
                      <div className="form-group">
                        <label>{t('orders.personalId')} *</label>
                        <input value={form.personalId} onChange={fv('personalId')} placeholder="e.g. 01234567890" required />
                      </div>
                      <div className="form-group">
                        <label>{t('orders.birthdate')} *</label>
                        <input type="date" value={form.birthdate} onChange={fv('birthdate')} required />
                      </div>
                      <div className="form-group">
                        <label>{t('orders.position')} *</label>
                        {positions.length > 0 ? (
                          <select value={form.position} onChange={fv('position')} required>
                            <option value="">{t('orders.selectPosition')}</option>
                            {positions.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                          </select>
                        ) : (
                          <input value={form.position} onChange={fv('position')} placeholder="e.g. Software Engineer" required />
                        )}
                      </div>
                      <div className="form-group">
                        <label>{t('orders.department')}</label>
                        {departments.length > 0 ? (
                          <select value={form.department} onChange={fv('department')}>
                            <option value="">{t('orders.selectDepartment')}</option>
                            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                          </select>
                        ) : (
                          <input value={form.department} onChange={fv('department')} placeholder="e.g. Engineering" />
                        )}
                      </div>
                      <div className="form-group">
                        <label>{t('orders.salary')} *</label>
                        <div style={{ display: 'flex', gap: 0, borderRadius: 8, border: '1px solid var(--border-2)', overflow: 'hidden' }}>
                          <select
                            value={form.salaryCurrency}
                            onChange={fv('salaryCurrency')}
                            required
                            style={{
                              flexShrink: 0, width: 78, padding: '0 6px', border: 'none', borderRight: '1px solid var(--border-2)',
                              cursor: 'pointer', fontSize: 12, fontWeight: 700,
                              background: 'var(--surface-2)', color: form.salaryCurrency ? 'var(--text)' : 'var(--text-3)',
                            }}
                          >
                            <option value="" disabled>{t('orders.currency')}</option>
                            {['GEL', 'USD', 'EUR'].map(cur => <option key={cur} value={cur}>{cur}</option>)}
                          </select>
                          <input
                            type="number" step="0.01" min="0"
                            value={form.salary} onChange={handleSalaryChange}
                            placeholder="e.g. 5000.00" required
                            style={{ flex: 1, border: 'none', outline: 'none', padding: '6px 10px', fontSize: 12.5, background: 'var(--surface)', color: 'var(--text)', minWidth: 0 }}
                          />
                        </div>
                      </div>
                      <div className="form-group">
                        <label>{t('orders.accruedSalary')}</label>
                        <input
                          type="number" step="0.01" min="0"
                          value={accruedInput}
                          onChange={handleAccruedChange}
                          placeholder="e.g. 5000.00"
                        />
                        <span className="photo-hint">{t('orders.accruedSalaryHint')}</span>
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <ImmediateEffectToggle value={form.immediateEffect} onToggle={v => setForm(p => ({ ...p, immediateEffect: v, startDate: v ? p.startDate : endOfMonth(currentMonthStr()) }))} />
                      </div>
                      <div className="form-group" style={{ maxWidth: 160 }}>
                        <label>{t('orders.startDate')} *</label>
                        <input type="date" value={form.startDate} onChange={fv('startDate')} required />
                      </div>
                      <div className="form-group" style={{ maxWidth: 160 }}>
                        <label>{t('orders.endDate')}</label>
                        <input type="date" value={form.endDate} onChange={fv('endDate')} />
                        <span className="photo-hint">{t('orders.endDateHint')}</span>
                      </div>
                      <div className="form-group">
                        <label>{t('orders.pitRate')}</label>
                        <select value={form.pitRate} onChange={handlePitRateChange}>
                          <option value="5">5%</option>
                          <option value="20">20%</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>{t('orders.accountNumber')}</label>
                        <input value={form.accountNumber} onChange={fv('accountNumber')} placeholder="e.g. GE29TB7894545082100008" maxLength={22} />
                      </div>
                      <div className="form-group">
                        <label>{t('orders.personalEmail')}</label>
                        <input type="email" value={form.personalEmail} onChange={fv('personalEmail')} placeholder="e.g. john@example.com" />
                      </div>
                      <div className="form-group">
                        <label>{t('orders.phone')}</label>
                        <input type="tel" value={form.phone} onChange={fv('phone')} placeholder="e.g. +995 555 000 000" />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>{t('orders.notes')}</label>
                        <input value={form.notes} onChange={fv('notes')} placeholder="Additional notes…" />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <div className="pension-toggle-row" style={{ width: 'fit-content' }} onClick={handlePensionToggle}>
                          <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={form.pension} onChange={handlePensionToggle} />
                            <span className="toggle-track" />
                          </label>
                          <span className="pension-label">
                            {t('orders.pension')}
                            <span className="pension-label-sub">{t('orders.pensionScheme')}</span>
                          </span>
                        </div>
                      </div>

                    </div>
                    <div className="form-actions">
                      <button type="button" className="btn-secondary" onClick={close}>{t('orders.cancel')}</button>
                      <button type="submit" className="btn-add" disabled={saving}>
                        {saving ? t('orders.saving') : editing ? t('orders.updateOrder') : t('orders.createEmployee')}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Account Changes */}
              {activeTab === 'account' && editing && (
                <HiringAccountChanges
                  orderId={editing}
                  currentAccount={orders.find(o => o.id === editing)?.accountNumber}
                />
              )}
              {activeTab === 'account' && !editing && (
                <HiringTabPlaceholder icon="#" title={t('orders.accountChanges')} text={t('orders.saveFirst') + ' to record account changes.'} />
              )}

              {/* Documents */}
              {activeTab === 'documents' && editing && <HiringDocuments orderId={editing} />}
              {activeTab === 'documents' && !editing && (
                <HiringTabPlaceholder icon="D" title={t('orders.documents')} text={t('orders.saveFirst') + ' to upload documents.'} />
              )}

              {/* Agreement */}
              {activeTab === 'agreement' && editing && (
                <HiringAgreement orderId={editing} order={orders.find(o => o.id === editing)} />
              )}
              {activeTab === 'agreement' && !editing && (
                <HiringTabPlaceholder icon="📄" title={t('orders.agreement')} text={t('orders.saveFirst') + ' to create agreements.'} />
              )}

              {/* Portal Access */}
              {activeTab === 'portal' && (
                <HiringTabPlaceholder icon="🔑" title={t('orders.portalAccess')} text="Link this hiring order to a system employee to configure portal access." />
              )}

          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function HiringTabPlaceholder({ icon, title, text }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 40px', textAlign: 'center', gap: 16 }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--text-3)' }}>{icon}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 320 }}>{text}</div>
      </div>
    </div>
  );
}

function HiringAccountChanges({ orderId, currentAccount }) {
  const storageKey = `hr_hiring_account_changes_${orderId}`;
  const [changes, setChanges] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; }
  });
  const [newAccount, setNewAccount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const save = (next) => { setChanges(next); localStorage.setItem(storageKey, JSON.stringify(next)); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (newAccount.length !== 22) { setError('Account number must be exactly 22 characters'); return; }
    setError(''); setSuccess('');
    const entry = {
      id: Date.now(),
      old_account: changes.length > 0 ? changes[0].new_account : (currentAccount || ''),
      new_account: newAccount,
      effective_date: effectiveDate,
      note,
      created_at: new Date().toISOString(),
    };
    save([entry, ...changes]);
    setSuccess('Account change recorded.');
    setNewAccount(''); setEffectiveDate(''); setNote('');
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this account change?')) return;
    save(changes.filter(c => c.id !== id));
  };

  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const acctColor = (a = '') => a.toUpperCase().includes('TB') ? '#60a5fa' : a.toUpperCase().includes('BG') ? '#d9673a' : 'var(--text)';

  const latestAccount = changes.length > 0 ? changes[0].new_account : currentAccount;

  return (
    <div className="tab-panel">
      <div className="tab-panel-header">
        <h3>Account Changes</h3>
        <p>Current account: <strong style={{ color: acctColor(latestAccount) }}>{latestAccount || 'Not set'}</strong></p>
      </div>

      {error && <div className="msg-error">{error}</div>}
      {success && <div className="msg-success">{success}</div>}

      <div className="sc-form-card">
        <h4>Record New Account Change</h4>
        <form onSubmit={handleSubmit}>
          <div className="sc-form-grid">
            <div className="form-group">
              <label>New Account Number</label>
              <input
                type="text" value={newAccount} maxLength={22}
                onChange={e => setNewAccount(e.target.value)}
                placeholder="e.g. GE29TB7894545082100008" required
                style={newAccount && newAccount.length !== 22 ? { borderColor: '#f87171' } : {}}
              />
              {newAccount && newAccount.length !== 22 && (
                <span style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>{newAccount.length}/22 characters</span>
              )}
            </div>
            <div className="form-group">
              <label>Effective Date</label>
              <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Note</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note…" />
            </div>
          </div>
          <button type="submit" className="btn-primary btn-sm">Record Change</button>
        </form>
      </div>

      {changes.length === 0 ? (
        <div className="sc-empty">No account changes recorded yet.</div>
      ) : (
        <div className="sc-timeline">
          {changes.map(c => (
            <div key={c.id} className="sc-item">
              <div className="sc-item-date">{fmtDate(c.effective_date)}</div>
              <div className="sc-item-detail">
                <div className="sc-item-salary">
                  <span style={{ color: acctColor(c.old_account), fontFamily: 'var(--font-mono)', fontSize: 13 }}>{c.old_account || '—'}</span>
                  <span className="sc-arrow">→</span>
                  <span style={{ color: acctColor(c.new_account), fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{c.new_account}</span>
                </div>
                {c.note && <div className="sc-item-note">{c.note}</div>}
              </div>
              <button onClick={() => handleDelete(c.id)} className="btn-icon btn-delete" title="Delete">🗑️</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HiringDocuments({ orderId }) {
  const metaKey = `hr_hiring_docs_meta_${orderId}`;
  const [docs, setDocs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(metaKey)) || []; } catch { return []; }
  });
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileRef = useRef();

  const saveMeta = (next) => { setDocs(next); localStorage.setItem(metaKey, JSON.stringify(next)); };

  const readAsBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('File too large. Max 5 MB.'); return; }
    setDocFile(file);
    if (!docName) setDocName(file.name.replace(/\.[^.]+$/, ''));
    setError('');
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!docFile) { setError('Please select a file.'); return; }
    setUploading(true); setError(''); setSuccess('');
    try {
      const b64 = await readAsBase64(docFile);
      const id = Date.now();
      localStorage.setItem(`hr_hiring_doc_file_${orderId}_${id}`, b64);
      const entry = {
        id,
        name: docName || docFile.name,
        filename: docFile.name,
        size: docFile.size,
        type: docFile.type,
        uploaded_at: new Date().toISOString(),
      };
      saveMeta([entry, ...docs]);
      setSuccess('Document uploaded successfully.');
      setDocName(''); setDocFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch { setError('Upload failed. File may be too large for browser storage.'); }
    finally { setUploading(false); }
  };

  const handleDownload = (doc) => {
    const b64 = localStorage.getItem(`hr_hiring_doc_file_${orderId}_${doc.id}`);
    if (!b64) { alert('File not found.'); return; }
    const a = document.createElement('a');
    a.href = b64;
    a.download = doc.filename;
    a.click();
  };

  const handleDelete = (doc) => {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    localStorage.removeItem(`hr_hiring_doc_file_${orderId}_${doc.id}`);
    saveMeta(docs.filter(d => d.id !== doc.id));
  };

  const fmtSize = (bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const fileIcon = (type = '') => {
    if (type.includes('pdf')) return '📄';
    if (type.includes('image')) return '🖼️';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel')) return '📊';
    return '📎';
  };

  return (
    <div className="tab-panel">
      <div className="tab-panel-header">
        <h3>Documents</h3>
        <p>Upload and manage documents for this hiring order</p>
      </div>

      {error && <div className="msg-error">{error}</div>}
      {success && <div className="msg-success">{success}</div>}

      {/* Upload form */}
      <div className="sc-form-card">
        <h4>Upload Document</h4>
        <form onSubmit={handleUpload}>
          <input ref={fileRef} type="file" hidden onChange={e => handleFile(e.target.files[0])} />
          <div className="sc-form-grid">
            <div className="form-group">
              <label>Document Name</label>
              <input value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Passport copy" required />
            </div>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => fileRef.current?.click()}
                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: docFile ? '#479c73' : 'var(--text-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                {docFile ? `${docFile.name} (${fmtSize(docFile.size)})` : 'Choose File'}
              </button>
            </div>
          </div>
          <button type="submit" className="btn-primary btn-sm" disabled={uploading || !docFile}>
            {uploading ? 'Uploading…' : 'Upload Document'}
          </button>
        </form>
      </div>

      {/* Document list */}
      {docs.length === 0 ? (
        <div className="sc-empty">No documents uploaded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {docs.map(doc => (
            <div key={doc.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
              background: 'var(--surface-2)', border: '1px solid var(--border-2)',
              borderRadius: 10, transition: 'background 0.12s',
            }}>
              <div style={{ fontSize: 24, flexShrink: 0 }}>{fileIcon(doc.type)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, display: 'flex', gap: 10 }}>
                  <span>{doc.filename}</span>
                  <span>·</span>
                  <span>{fmtSize(doc.size)}</span>
                  <span>·</span>
                  <span>Uploaded {fmtDate(doc.uploaded_at)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => handleDownload(doc)}
                  style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = '#3b82f6'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border-2)'; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(220,38,38,0.4)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border-2)'; }}
                ><DeleteIcon /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HiringAgreement({ orderId, order }) {
  const storageKey = `hr_hiring_agreements_${orderId}`;
  const [agreements, setAgreements] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; }
  });
  const emptyForm = {
    title: 'Employment Agreement',
    type: 'Employment',
    party_name: order ? `${order.firstName} ${order.lastName}` : '',
    start_date: order?.startDate || '',
    end_date: order?.endDate || '',
    amount: order?.salary || '',
    currency: 'GEL',
    status: 'active',
    notes: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [signUrls, setSignUrls] = useState({});
  const [emailOverride, setEmailOverride] = useState('');
  const [emailPromptId, setEmailPromptId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const saveAll = (next) => { setAgreements(next); localStorage.setItem(storageKey, JSON.stringify(next)); };
  const hc = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleCreate = (e) => {
    e.preventDefault();
    setSaving(true);
    const ag = { id: Date.now(), ...form, created_at: new Date().toISOString() };
    saveAll([ag, ...agreements]);
    setSuccess('Agreement created.');
    setShowForm(false);
    setForm(emptyForm);
    setSaving(false);
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this agreement?')) return;
    saveAll(agreements.filter(a => a.id !== id));
  };

  const generatePDF = (ag) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 20, pageW = 210, contentW = pageW - margin * 2;
    let y = 25;

    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text('EMPLOYMENT AGREEMENT', margin, 9.5);
    doc.text(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), pageW - margin, 9.5, { align: 'right' });

    doc.setTextColor(15, 23, 42); doc.setFontSize(20);
    doc.text(ag.title || 'Employment Agreement', pageW / 2, y + 10, { align: 'center' });
    y += 22;

    const statusColors = { active: [220, 252, 231], inactive: [241, 245, 249], terminated: [254, 242, 242] };
    const statusText  = { active: [21, 128, 61],  inactive: [71, 85, 105],    terminated: [220, 38, 38] };
    doc.setFillColor(...(statusColors[ag.status] || statusColors.inactive));
    doc.roundedRect(pageW / 2 - 20, y, 40, 7, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(...(statusText[ag.status] || statusText.inactive));
    doc.text((ag.status || 'active').toUpperCase(), pageW / 2, y + 4.8, { align: 'center' });
    y += 16;

    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4);
    doc.line(margin, y, pageW - margin, y); y += 10;

    const section = (t) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(37, 99, 235);
      doc.text(t, margin, y); doc.setDrawColor(37, 99, 235); doc.setLineWidth(0.3);
      doc.line(margin, y + 1, margin + doc.getTextWidth(t), y + 1); y += 7;
    };
    const row = (lbl, val) => {
      if (!val) return;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(71, 85, 105);
      doc.text(lbl + ':', margin, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42);
      doc.text(String(val), margin + 45, y); y += 7;
    };

    section('PARTIES');
    row('Party Name', ag.party_name || '—');
    row('Agreement Type', ag.type || '—');
    y += 3;

    section('TERMS & CONDITIONS');
    row('Start Date', ag.start_date ? new Date(ag.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
    row('End Date', ag.end_date ? new Date(ag.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Open-ended');
    row('Amount', ag.amount ? `${Number(ag.amount).toLocaleString()} ${ag.currency}` : '—');
    y += 3;

    if (ag.notes) {
      section('ADDITIONAL NOTES');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(71, 85, 105);
      const lines = doc.splitTextToSize(ag.notes, contentW);
      doc.text(lines, margin, y); y += lines.length * 5.5 + 8;
    }

    y = Math.max(y + 10, 210);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4);
    doc.line(margin, y, pageW - margin, y); y += 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(37, 99, 235);
    doc.text('SIGNATURES', margin, y); y += 12;

    const sigBox = (x, label, name) => {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, 75, 28, 3, 3, 'F');
      doc.setDrawColor(226, 232, 240); doc.roundedRect(x, y, 75, 28, 3, 3, 'S');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
      doc.text(label, x + 4, y + 6);
      doc.setLineWidth(0.3); doc.setDrawColor(148, 163, 184);
      doc.line(x + 4, y + 20, x + 70, y + 20);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
      doc.text(name, x + 4, y + 25);
    };
    sigBox(margin, 'EMPLOYER', 'Authorized Signature & Date');
    sigBox(pageW - margin - 75, 'EMPLOYEE', `${ag.party_name || 'Employee'} & Date`);

    doc.setFillColor(37, 99, 235); doc.rect(0, 282, pageW, 15, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
    doc.text(`Generated on ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  |  Agreement ID: ${ag.id}`, pageW / 2, 290, { align: 'center' });
    doc.save(`${(ag.title || 'agreement').replace(/\s+/g, '-')}.pdf`);
  };

  const doSendSignLink = async (ag, email) => {
    setSendingId(ag.id); setError(''); setSuccess(''); setEmailPromptId(null);
    try {
      const createRes = await api.post('/documents', {
        employee_id: null,
        employee_name: ag.party_name,
        type: 'hiring',
        title: ag.title,
        content: {
          job_title: ag.type,
          start_date: ag.start_date ? new Date(ag.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
          end_date: ag.end_date ? new Date(ag.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
          salary: ag.amount,
          currency: ag.currency,
          notes: ag.notes,
        },
      });
      const docId = createRes.data.document.id;
      const sendRes = await api.post(`/documents/${docId}/send`, { email: email || null, employee_name: ag.party_name });
      setSignUrls(p => ({ ...p, [ag.id]: sendRes.data.sign_url }));
      setSuccess(email ? `Sign link sent to ${email}` : 'Sign link created — copy it below.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send sign link.');
    } finally { setSendingId(null); }
  };

  const handleSend = (ag) => {
    const email = order?.personalEmail;
    if (!email) { setEmailPromptId(ag.id); setEmailOverride(''); }
    else doSendSignLink(ag, email);
  };

  const statusBadge = (s) => {
    const map = { active: ['rgba(71,156,115,0.15)','#479c73'], inactive: ['#f1f5f9','#475569'], terminated: ['#fef2f2','#dc2626'] };
    const [bg, color] = map[s] || map.inactive;
    return <span style={{ background: bg, color, padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>{s}</span>;
  };

  const agLs = {
    label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' },
    input: { width: '100%', padding: '9px 12px', border: '1.5px solid var(--border-2)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' },
  };

  return (
    <div style={{ padding: '24px 0', maxWidth: 740 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Agreements</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>Create, sign and send employment agreements</p>
        </div>
        <button onClick={() => { setShowForm(f => !f); setError(''); setSuccess(''); }}
          style={{ padding: '8px 18px', background: 'var(--accent,#3b82f6)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {showForm ? 'Cancel' : '+ Create Agreement'}
        </button>
      </div>

      {error   && <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.15)', color: '#f87171', borderRadius: 8, fontSize: 13, marginBottom: 14, border: '1px solid rgba(220,38,38,0.3)' }}>{error}</div>}
      {success && <div style={{ padding: '10px 14px', background: 'rgba(71,156,115,0.15)', color: '#479c73', borderRadius: 8, fontSize: 13, marginBottom: 14, border: '1px solid rgba(71,156,115,0.3)' }}>{success}</div>}

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[['Title', 'title'], ['Party Name', 'party_name']].map(([lbl, name]) => (
              <div key={name}><label style={agLs.label}>{lbl}</label><input name={name} value={form[name]} onChange={hc} required style={agLs.input} /></div>
            ))}
            <div><label style={agLs.label}>Type</label>
              <select name="type" value={form.type} onChange={hc} style={agLs.input}>
                {['Employment','Service','Contractor','NDA','Other'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div><label style={agLs.label}>Status</label>
              <select name="status" value={form.status} onChange={hc} style={agLs.input}>
                {['active','inactive','terminated'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div><label style={agLs.label}>Start Date</label><input name="start_date" type="date" value={form.start_date} onChange={hc} style={agLs.input} /></div>
            <div><label style={agLs.label}>End Date</label><input name="end_date" type="date" value={form.end_date} onChange={hc} style={agLs.input} /></div>
            <div><label style={agLs.label}>Amount</label><input name="amount" type="number" step="0.01" min="0" value={form.amount} onChange={hc} style={agLs.input} /></div>
            <div><label style={agLs.label}>Currency</label>
              <select name="currency" value={form.currency} onChange={hc} style={agLs.input}>
                {['GEL','USD','EUR'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}><label style={agLs.label}>Notes</label>
              <textarea name="notes" value={form.notes} onChange={hc} rows={3} style={{ ...agLs.input, resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="submit" disabled={saving}
              style={{ padding: '9px 24px', background: 'var(--accent,#3b82f6)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Create Agreement'}
            </button>
          </div>
        </form>
      )}

      {agreements.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-4)', fontSize: 14, border: '1px dashed var(--border-2)', borderRadius: 10 }}>
          No agreements yet. Click "+ Create Agreement" to add one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {agreements.map(ag => (
            <div key={ag.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{ag.title}</span>
                    {statusBadge(ag.status)}
                    <span style={{ fontSize: 12, color: 'var(--text-4)', background: 'var(--surface)', padding: '2px 8px', borderRadius: 12 }}>{ag.type}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {ag.party_name && <span>Party: {ag.party_name}</span>}
                    {ag.amount && <span>Amount: {ag.amount} {ag.currency}</span>}
                    {ag.start_date && <span>From: {new Date(ag.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                    {ag.end_date && <span>To: {new Date(ag.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                  </div>
                  {ag.notes && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-4)' }}>{ag.notes}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  {/* Download PDF */}
                  <button onClick={() => generatePDF(ag)}
                    style={btnStyle('#3b82f6')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    PDF
                  </button>
                  {/* Send Sign Link */}
                  <button onClick={() => handleSend(ag)} disabled={sendingId === ag.id}
                    style={btnStyle('#8b5cf6')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    {sendingId === ag.id ? 'Sending…' : 'Send for Signature'}
                  </button>
                  {/* Delete */}
                  <button onClick={() => handleDelete(ag.id)}
                    style={{ background: 'none', border: '1px solid rgba(220,38,38,0.35)', color: '#f87171', borderRadius: 7, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
                    Delete
                  </button>
                </div>
              </div>

              {/* Email prompt */}
              {emailPromptId === ag.id && (
                <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="email" placeholder="Enter employee email…" value={emailOverride} onChange={e => setEmailOverride(e.target.value)}
                    style={{ ...agLs.input, flex: 1, padding: '6px 10px', fontSize: 12 }} />
                  <button onClick={() => doSendSignLink(ag, emailOverride || null)} disabled={!emailOverride}
                    style={{ padding: '6px 14px', background: 'var(--accent,#3b82f6)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Send
                  </button>
                  <button onClick={() => setEmailPromptId(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 18 }}>×</button>
                </div>
              )}

              {/* Sign URL */}
              {signUrls[ag.id] && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(71,156,115,0.08)', borderRadius: 8, border: '1px solid rgba(71,156,115,0.25)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#479c73" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                  </svg>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 1, wordBreak: 'break-all' }}>{signUrls[ag.id]}</span>
                  <button onClick={() => navigator.clipboard.writeText(signUrls[ag.id])}
                    style={{ background: 'none', border: '1px solid var(--border-2)', borderRadius: 5, padding: '3px 8px', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Copy
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnStyle = (color) => ({
  background: 'none', border: `1px solid var(--border-2)`, color: 'var(--text-3)',
  borderRadius: 7, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600,
  transition: 'color 0.15s, border-color 0.15s',
});

// ── Firing Tab ────────────────────────────────────────────────────────────────
function FiringTab({ employees, registerAdd }) {
  const { t } = useLanguage();
  const { orders: localOrders, add, update, remove } = useLocalOrders('hr_firing_orders', o => employees.some(e => e.id === o.employeeId));

  // An employee can be terminated directly on the Employees page (setting end_date)
  // without going through this tab's own form — pull those in live so every
  // termination shows here regardless of how it was recorded.
  const localEmpIds = new Set(localOrders.map(o => o.employeeId));
  const liveOnlyRows = employees
    .filter(e => e.end_date && !localEmpIds.has(e.id))
    .map(e => ({
      id: `live-${e.id}`,
      employeeId: e.id,
      empName: `${e.first_name} ${e.last_name}`,
      position: e.position || '',
      terminationDate: e.end_date,
      reason: '',
      notes: '',
      createdAt: e.end_date,
      _live: true,
    }));
  const orders = [...localOrders, ...liveOnlyRows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  // Firing orders used to only ever be written to this browser's localStorage,
  // never to the employee record itself — so they silently vanished on another
  // device, and never affected payroll. Push any already-logged order's date
  // onto the real employee record once, so it becomes a real, synced fact.
  useEffect(() => {
    localOrders.forEach(o => {
      const emp = employees.find(e => e.id === o.employeeId);
      if (emp && emp.end_date !== o.terminationDate) {
        api.patch(`/employees/${o.employeeId}/end-date`, { end_date: o.terminationDate }).catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const EMPTY = { employeeId: '', terminationDate: '', reason: '', notes: '', immediateEffect: true };
  const [form, setForm] = useState(EMPTY);
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const perms = useOrdersPermissions();
  const canCreate = perms.create_firing === 'Yes';

  const [detailsFor, setDetailsFor] = useState(null);
  const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  useEffect(() => { if (registerAdd) registerAdd.current = openAdd; });
  const openEdit = (o) => { setEditing(o.id); setForm({ employeeId: o.employeeId, terminationDate: o.terminationDate, reason: o.reason, notes: o.notes || '' }); setShowForm(true); };
  const openCopy = (o) => { setEditing(null); setForm({ employeeId: o.employeeId, terminationDate: o.terminationDate, reason: o.reason, notes: o.notes || '' }); setShowForm(true); };
  const close = () => { setShowForm(false); setEditing(null); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const emp = employees.find(x => x.id === form.employeeId);
    const row = { ...form, empName: emp ? `${emp.first_name} ${emp.last_name}` : '', position: emp?.position || '' };
    editing ? update(editing, row) : add(row);
    api.patch(`/employees/${form.employeeId}/end-date`, { end_date: form.terminationDate }).catch(() => {});
    close();
  };

  const handleRemove = (o) => {
    if (!o._live) remove(o.id);
    api.patch(`/employees/${o.employeeId}/end-date`, { end_date: null }).catch(() => {});
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(orders, [
          { header: 'Date', get: o => o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '' },
          { header: 'Employee', get: o => o.empName || '' },
          { header: 'Position', get: o => o.position || '' },
          { header: 'Termination Date', get: o => o.terminationDate || '' },
          { header: 'Reason', get: o => o.reason || '' },
          { header: 'Notes', get: o => o.notes || '' },
        ], 'Firing', 'Firing-Orders')} />}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {orders.length === 0 ? <EmptyState label={t('orders.firing')} onAdd={canCreate ? openAdd : undefined} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {[t('orders.date'), t('orders.employee'), t('orders.position'), t('orders.terminationDate'), t('orders.reason'), t('orders.notes'), ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)', cursor: 'pointer' }} onClick={openRowMenu} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)' }}>{o.empName}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.position || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#f87171', fontWeight: 600, whiteSpace: 'nowrap' }}>{o.terminationDate ? new Date(o.terminationDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text)' }}>{o.reason || (o._live ? '—' : '')}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes || '—'}</td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <RowActionsMenu
                        t={t}
                        onCopy={o._live ? undefined : () => openCopy(o)}
                        onEdit={o._live ? undefined : () => openEdit(o)}
                        onDetails={() => setDetailsFor(o)}
                        onDelete={() => handleRemove(o)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {detailsFor && (
        <DetailsModal
          t={t}
          title={t('orders.firing')}
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: t('orders.date'), value: new Date(detailsFor.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: t('orders.employee'), value: detailsFor.empName },
            { label: t('orders.position'), value: detailsFor.position },
            { label: t('orders.terminationDate'), value: detailsFor.terminationDate ? new Date(detailsFor.terminationDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null },
            { label: t('orders.reason'), value: detailsFor.reason },
            { label: t('orders.notes'), value: detailsFor.notes },
          ]}
        />
      )}
      {showForm && (
        <SubTabModal title={editing ? t('orders.editFiringOrder') : t('orders.newFiringOrder')} onClose={close}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div><label style={LABEL}>{t('orders.employee')} *</label>
                <EmployeeSearchSelect employees={employees} value={form.employeeId} required placeholder={t('orders.selectEmployee')} onChange={f('employeeId')} />
              </div>
              <ImmediateEffectToggle value={form.immediateEffect} onToggle={v => setForm(p => ({ ...p, immediateEffect: v, terminationDate: v ? p.terminationDate : endOfMonth(currentMonthStr()) }))} />
              <div><label style={LABEL}>{t('orders.terminationDate')} *</label><input type="date" value={form.terminationDate} onChange={f('terminationDate')} required style={{ ...INPUT, width: '100%' }} /></div>
              <div><label style={LABEL}>{t('orders.reason')} *</label><input value={form.reason} onChange={f('reason')} required style={{ ...INPUT, width: '100%' }} /></div>
              <div><label style={LABEL}>{t('orders.notes')}</label><input value={form.notes} onChange={f('notes')} style={{ ...INPUT, width: '100%' }} /></div>
            </div>
            <SubTabActions onCancel={close} disabled={!form.employeeId || !form.terminationDate || !form.reason} />
          </form>
        </SubTabModal>
      )}
    </div>
  );
}

// ── Business Trip Per Diem rates (USD/day, Georgian government decree) ────────
const COUNTRIES = [
  { code: 'us', name: 'United States',          perDiem: 65, cities: [{ name: 'Washington D.C.', perDiem: 90 }, { name: 'New York', perDiem: 100 }, { name: 'San Francisco', perDiem: 95 }] },
  { code: 'gb', name: 'United Kingdom',         perDiem: 70, cities: [{ name: 'London', perDiem: 90 }, { name: 'Edinburgh', perDiem: 80 }] },
  { code: 'de', name: 'Germany',                perDiem: 65, cities: [{ name: 'Berlin', perDiem: 80 }, { name: 'Munich', perDiem: 85 }] },
  { code: 'fr', name: 'France',                 perDiem: 65, cities: [{ name: 'Paris', perDiem: 85 }, { name: 'Lyon', perDiem: 75 }] },
  { code: 'it', name: 'Italy',                  perDiem: 65, cities: [{ name: 'Rome', perDiem: 80 }, { name: 'Milan', perDiem: 85 }] },
  { code: 'es', name: 'Spain',                  perDiem: 60, cities: [{ name: 'Madrid', perDiem: 75 }] },
  { code: 'nl', name: 'Netherlands',            perDiem: 65, cities: [{ name: 'Amsterdam', perDiem: 80 }] },
  { code: 'be', name: 'Belgium',                perDiem: 65, cities: [{ name: 'Brussels', perDiem: 80 }] },
  { code: 'ch', name: 'Switzerland',            perDiem: 80, cities: [{ name: 'Bern', perDiem: 95 }] },
  { code: 'at', name: 'Austria',                perDiem: 65, cities: [{ name: 'Vienna', perDiem: 80 }] },
  { code: 'se', name: 'Sweden',                 perDiem: 65, cities: [{ name: 'Stockholm', perDiem: 80 }] },
  { code: 'no', name: 'Norway',                 perDiem: 70, cities: [{ name: 'Oslo', perDiem: 85 }] },
  { code: 'dk', name: 'Denmark',                perDiem: 65, cities: [{ name: 'Copenhagen', perDiem: 80 }] },
  { code: 'fi', name: 'Finland',                perDiem: 60, cities: [{ name: 'Helsinki', perDiem: 75 }] },
  { code: 'pl', name: 'Poland',                 perDiem: 50, cities: [{ name: 'Warsaw', perDiem: 65 }] },
  { code: 'cz', name: 'Czech Republic',         perDiem: 50, cities: [{ name: 'Prague', perDiem: 65 }] },
  { code: 'hu', name: 'Hungary',                perDiem: 45, cities: [{ name: 'Budapest', perDiem: 60 }] },
  { code: 'ro', name: 'Romania',                perDiem: 40, cities: [{ name: 'Bucharest', perDiem: 55 }] },
  { code: 'gr', name: 'Greece',                 perDiem: 55, cities: [{ name: 'Athens', perDiem: 70 }] },
  { code: 'pt', name: 'Portugal',               perDiem: 55, cities: [{ name: 'Lisbon', perDiem: 70 }] },
  { code: 'tr', name: 'Turkey',                 perDiem: 45, cities: [{ name: 'Ankara', perDiem: 55 }] },
  { code: 'ru', name: 'Russia',                 perDiem: 40, cities: [{ name: 'Moscow', perDiem: 55 }] },
  { code: 'ua', name: 'Ukraine',                perDiem: 35, cities: [{ name: 'Kyiv', perDiem: 50 }] },
  { code: 'am', name: 'Armenia',                perDiem: 30, cities: [{ name: 'Yerevan', perDiem: 45 }] },
  { code: 'az', name: 'Azerbaijan',             perDiem: 35, cities: [{ name: 'Baku', perDiem: 50 }] },
  { code: 'kz', name: 'Kazakhstan',             perDiem: 40, cities: [{ name: 'Astana', perDiem: 55 }] },
  { code: 'ae', name: 'United Arab Emirates',   perDiem: 60, cities: [{ name: 'Abu Dhabi', perDiem: 75 }] },
  { code: 'sa', name: 'Saudi Arabia',           perDiem: 55, cities: [{ name: 'Riyadh', perDiem: 70 }] },
  { code: 'il', name: 'Israel',                 perDiem: 65, cities: [{ name: 'Jerusalem', perDiem: 80 }] },
  { code: 'cn', name: 'China',                  perDiem: 55, cities: [{ name: 'Beijing', perDiem: 70 }] },
  { code: 'jp', name: 'Japan',                  perDiem: 65, cities: [{ name: 'Tokyo', perDiem: 80 }] },
  { code: 'kr', name: 'South Korea',            perDiem: 60, cities: [{ name: 'Seoul', perDiem: 75 }] },
  { code: 'in', name: 'India',                  perDiem: 45, cities: [{ name: 'New Delhi', perDiem: 60 }] },
  { code: 'sg', name: 'Singapore',              perDiem: 65, cities: [{ name: 'Singapore', perDiem: 80 }] },
  { code: 'th', name: 'Thailand',               perDiem: 45, cities: [{ name: 'Bangkok', perDiem: 60 }] },
  { code: 'ca', name: 'Canada',                 perDiem: 65, cities: [{ name: 'Ottawa', perDiem: 80 }] },
  { code: 'au', name: 'Australia',              perDiem: 65, cities: [{ name: 'Canberra', perDiem: 80 }] },
  { code: 'nz', name: 'New Zealand',            perDiem: 60, cities: [{ name: 'Wellington', perDiem: 75 }] },
  { code: 'za', name: 'South Africa',           perDiem: 45, cities: [{ name: 'Pretoria', perDiem: 60 }] },
  { code: 'eg', name: 'Egypt',                  perDiem: 40, cities: [{ name: 'Cairo', perDiem: 55 }] },
  { code: 'ma', name: 'Morocco',                perDiem: 40, cities: [{ name: 'Rabat', perDiem: 55 }] },
  { code: 'br', name: 'Brazil',                 perDiem: 50, cities: [{ name: 'Brasilia', perDiem: 65 }] },
  { code: 'mx', name: 'Mexico',                 perDiem: 50, cities: [{ name: 'Mexico City', perDiem: 65 }] },
  { code: 'ar', name: 'Argentina',              perDiem: 45, cities: [{ name: 'Buenos Aires', perDiem: 60 }] },
  { code: 'lt', name: 'Lithuania',              perDiem: 50, cities: [{ name: 'Vilnius', perDiem: 65 }] },
  { code: 'lv', name: 'Latvia',                 perDiem: 50, cities: [{ name: 'Riga', perDiem: 65 }] },
  { code: 'ee', name: 'Estonia',                perDiem: 50, cities: [{ name: 'Tallinn', perDiem: 65 }] },
  { code: 'by', name: 'Belarus',                perDiem: 35, cities: [{ name: 'Minsk', perDiem: 50 }] },
  { code: 'md', name: 'Moldova',                perDiem: 30, cities: [{ name: 'Chișinău', perDiem: 45 }] },
  { code: 'rs', name: 'Serbia',                 perDiem: 40, cities: [{ name: 'Belgrade', perDiem: 55 }] },
  { code: 'hr', name: 'Croatia',                perDiem: 50, cities: [{ name: 'Zagreb', perDiem: 65 }] },
  { code: 'sk', name: 'Slovakia',               perDiem: 50, cities: [{ name: 'Bratislava', perDiem: 65 }] },
  { code: 'bg', name: 'Bulgaria',               perDiem: 40, cities: [{ name: 'Sofia', perDiem: 55 }] },
].sort((a, b) => a.name.localeCompare(b.name));

function flagUrl(code) {
  return `https://flagcdn.com/w40/${code}.png`;
}

function calcDays(from, to) {
  if (!from || !to) return 0;
  const ms = new Date(to) - new Date(from);
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000) + 1;
}

// ── Trip Costs ────────────────────────────────────────────────────────────────
function TripCosts({ tripId, onCostsChanged }) {
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [costName, setCostName] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [costFile, setCostFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/business-trips/${tripId}/costs`);
      setCosts((res.data.records || []).map(r => ({
        id: r.id, name: r.name, amount: r.amount,
        fileName: r.file_name, fileType: r.file_type, fileData: r.file_data,
      })));
    } catch { setCosts([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tripId]);

  const readAsBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!costName.trim()) return;
    setUploading(true);
    try {
      let fileData = null, fileName = null, fileType = null;
      if (costFile) {
        fileData = await readAsBase64(costFile);
        fileName = costFile.name;
        fileType = costFile.type;
      }
      await api.post(`/business-trips/${tripId}/costs`, {
        name: costName.trim(), amount: costAmount || null,
        file_name: fileName, file_type: fileType, file_data: fileData,
      });
      setCostName(''); setCostAmount(''); setCostFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
      if (onCostsChanged) onCostsChanged();
    } finally { setUploading(false); }
  };

  const handleRemoveCost = async (c) => {
    try { await api.delete(`/business-trips/${tripId}/costs/${c.id}`); } catch {}
    await load();
    if (onCostsChanged) onCostsChanged();
  };

  const handleDownload = (c) => {
    const a = document.createElement('a');
    a.href = c.fileData;
    a.download = c.fileName;
    a.click();
  };

  const totalCosts = costs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>;
  }

  const fileIcon = (type) => {
    if (!type) return '📎';
    if (type.includes('pdf')) return '📄';
    if (type.includes('image')) return '🖼️';
    return '📎';
  };

  return (
    <div>
      {/* Add cost form */}
      <form onSubmit={handleAdd} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14, marginBottom: 16, border: '1px solid var(--border-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={LABEL}>Cost Name *</label>
            <input value={costName} onChange={e => setCostName(e.target.value)} placeholder="e.g. Hotel, Taxi, Meals…" style={INPUT} required />
          </div>
          <div>
            <label style={LABEL}>Amount (USD)</label>
            <input type="number" min="0" step="0.01" value={costAmount} onChange={e => setCostAmount(e.target.value)} placeholder="0.00" style={INPUT} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={e => setCostFile(e.target.files[0] || null)} />
          <button type="button" onClick={() => fileRef.current?.click()}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border-2)', background: 'var(--surface)', color: costFile ? '#479c73' : 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {costFile ? costFile.name.slice(0, 22) + (costFile.name.length > 22 ? '…' : '') : 'Attach PDF / Image'}
          </button>
          {costFile && <button type="button" onClick={() => { setCostFile(null); if (fileRef.current) fileRef.current.value = ''; }} style={{ color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>}
          <button type="submit" disabled={uploading || !costName.trim()} style={{ marginLeft: 'auto', padding: '7px 18px', borderRadius: 7, border: 'none', background: uploading || !costName.trim() ? 'var(--surface-3)' : '#0ea5e9', color: uploading || !costName.trim() ? 'var(--text-4)' : '#fff', fontWeight: 700, fontSize: 13, cursor: uploading || !costName.trim() ? 'not-allowed' : 'pointer' }}>
            {uploading ? 'Adding…' : '+ Add Cost'}
          </button>
        </div>
      </form>

      {/* Cost list */}
      {costs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-3)', fontSize: 13 }}>No costs added yet</div>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 9, overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['#', 'Name', 'File', 'Amount', ''].map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', textAlign: i === 3 ? 'right' : 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {costs.map((c, idx) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border-2)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '9px 12px', color: 'var(--text-4)', fontSize: 12, width: 32 }}>{idx + 1}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text)' }}>{c.name}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--text-3)', fontSize: 12 }}>
                    {c.fileData
                      ? <button onClick={() => handleDownload(c)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: 0 }}>
                          <span>{fileIcon(c.fileType)}</span>{c.fileName}
                        </button>
                      : <span style={{ color: 'var(--text-4)' }}>—</span>
                    }
                  </td>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: '#479c73', textAlign: 'right', whiteSpace: 'nowrap' }}>{c.amount ? `$${c.amount}` : '—'}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    <button onClick={() => handleRemoveCost(c)}
                      style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--border-2)', background: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#f87171'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-4)'}><DeleteIcon /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(71,156,115,0.08)', borderRadius: 8, border: '1px solid rgba(71,156,115,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>Total Costs</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#479c73' }}>${totalCosts.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function BusinessTripTab({ employees, registerAdd }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modalTab, setModalTab] = useState('details');
  const [countrySearch, setCountrySearch] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  const countryRef = React.useRef(null);
  const [citySearch, setCitySearch] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  const cityRef = React.useRef(null);
  const [empOpen, setEmpOpen] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const empRef = React.useRef(null);
  const [expandedGroups, setExpandedGroups] = useState({});

  const EMPTY = {
    employeeId: '', employeeIds: [], isGroup: false, groupName: '',
    fromDate: '', toDate: '',
    countryCode: '', countryName: '', cityName: '',
    perDiem: '', amount: '', notes: '',
    immediateEffect: true,
  };
  const [form, setForm] = useState(EMPTY);

  const days = calcDays(form.fromDate, form.toDate);
  const autoAmount = form.perDiem && days > 0 ? (parseFloat(form.perDiem) * days).toFixed(2) : '';

  const perms = useOrdersPermissions();
  const canCreate = perms.create_business_trip === 'Yes';

  const mapRecord = (r) => {
    const emp = employees.find(e => e.id === r.employee_id);
    return {
      id: r.id, employeeId: r.employee_id,
      empName: emp ? `${emp.first_name} ${emp.last_name}` : '',
      groupId: r.group_id, groupName: r.group_name,
      fromDate: r.from_date, toDate: r.to_date,
      countryCode: r.country_code, countryName: r.country_name, cityName: r.city_name,
      perDiem: r.per_diem, amount: r.amount, days: r.days, notes: r.notes,
      totalCosts: r.total_costs || 0,
    };
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/business-trips');
      setOrders((res.data.records || []).map(mapRecord));
    } catch { setOrders([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [employees]);

  const remove = async (id) => {
    try { await api.delete(`/business-trips/${id}`); } catch {}
    await load();
  };

  React.useEffect(() => {
    const handler = (e) => {
      if (countryRef.current && !countryRef.current.contains(e.target)) setCountryOpen(false);
      if (cityRef.current && !cityRef.current.contains(e.target)) setCityOpen(false);
      if (empRef.current && !empRef.current.contains(e.target)) setEmpOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectCountry = (c) => {
    setForm(f => ({
      ...f,
      countryCode: c.code,
      countryName: c.name,
      cityName: '',
      perDiem: String(c.perDiem),
      amount: f.amount || (c.perDiem * calcDays(f.fromDate, f.toDate)).toFixed(2),
    }));
    setCountryOpen(false);
    setCountrySearch('');
  };

  const selectCity = (city) => {
    setForm(f => ({
      ...f,
      cityName: city.name,
      perDiem: String(city.perDiem),
      amount: (city.perDiem * calcDays(f.fromDate, f.toDate)).toFixed(2),
    }));
    setCityOpen(false);
  };

  const filteredCountries = countrySearch
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(countrySearch.toLowerCase()))
    : COUNTRIES;

  const [detailsFor, setDetailsFor] = useState(null);
  const openAdd = () => { setEditing(null); setForm(EMPTY); setCountrySearch(''); setEmpSearch(''); setModalTab('details'); setShowForm(true); };
  useEffect(() => { if (registerAdd) registerAdd.current = openAdd; });
  const openEdit = (o) => {
    setEditing(o.id);
    setForm({ employeeId: o.employeeId, employeeIds: [], isGroup: false, fromDate: o.fromDate, toDate: o.toDate, countryCode: o.countryCode, countryName: o.countryName, cityName: o.cityName || '', perDiem: o.perDiem || '', amount: o.amount || '', notes: o.notes || '' });
    setModalTab('details');
    setShowForm(true);
  };
  const openCopy = (o) => {
    setEditing(null);
    setForm({ employeeId: o.employeeId, employeeIds: [], isGroup: false, fromDate: o.fromDate, toDate: o.toDate, countryCode: o.countryCode, countryName: o.countryName, cityName: o.cityName || '', perDiem: o.perDiem || '', amount: o.amount || '', notes: o.notes || '' });
    setModalTab('details');
    setShowForm(true);
  };
  const close = () => { setShowForm(false); setEditing(null); load(); };

  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const finalAmount = form.amount || autoAmount;
      const destination = [form.countryName, form.cityName].filter(Boolean).join(', ');

      const targetIds = !editing && form.isGroup
        ? form.employeeIds
        : [form.employeeId];

      const groupId = !editing && form.isGroup && targetIds.length > 1
        ? `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : null;
      const groupName = groupId ? (form.groupName.trim() || `Group of ${targetIds.length}`) : null;

      for (const eid of targetIds) {
        const emp = employees.find(x => x.id === eid);
        const payload = {
          employee_id: eid,
          from_date: form.fromDate, to_date: form.toDate,
          country_code: form.countryCode, country_name: form.countryName, city_name: form.cityName,
          per_diem: form.perDiem || null, amount: finalAmount || null, days,
          notes: form.notes || null,
          ...(groupId ? { group_id: groupId, group_name: groupName } : {}),
        };
        if (editing) {
          await api.put(`/business-trips/${editing}`, payload);
        } else {
          await api.post('/business-trips', payload);
        }

        if (!editing && finalAmount) {
          try {
            await api.post('/accounting/transfers', {
              client_name: emp ? `${emp.first_name} ${emp.last_name}` : eid,
              amount: parseFloat(finalAmount),
              due_date: form.toDate,
              description: `Business Trip: ${destination} (${form.fromDate} → ${form.toDate})`,
              status: 'normal',
              auto_approved: true,
            });
          } catch (err) {
            console.warn('Could not create transfer for business trip:', err.message);
          }
        }
      }

      if (!editing) { close(); } else { setModalTab('details'); await load(); }
    } finally { setSaving(false); }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const MODAL_TABS = [
    { key: 'details', label: 'Details' },
    { key: 'costs',   label: 'Costs'   },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(orders, [
          { header: 'Date', get: o => o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '' },
          { header: 'Employee', get: o => o.empName || '' },
          { header: 'Group', get: o => o.groupName || '' },
          { header: 'From', get: o => o.fromDate || '' },
          { header: 'To', get: o => o.toDate || '' },
          { header: 'Days', get: o => o.days || '' },
          { header: 'Country', get: o => o.countryName || '' },
          { header: 'City', get: o => o.cityName || '' },
          { header: 'Per Diem', get: o => o.perDiem || '' },
          { header: 'Amount', get: o => o.amount || '' },
          { header: 'Total Costs', get: o => o.totalCosts || 0 },
          { header: 'Notes', get: o => o.notes || '' },
        ], 'Business Trip', 'Business-Trip-Orders')} />}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 24px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✈️</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15, marginBottom: 6 }}>No business trips recorded</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>Click "New Business Trip" to add one</div>
            {canCreate && <button onClick={openAdd} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>+ New Business Trip</button>}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['Employee', 'Period', 'Days', 'Destination', 'Per Diem/day', 'Amount', 'Total Costs', 'Notes', ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rendered = [];
                const seenGroups = new Set();
                for (const o of orders) {
                  if (o.groupId && seenGroups.has(o.groupId)) continue;
                  if (o.groupId) {
                    seenGroups.add(o.groupId);
                    const members = orders.filter(x => x.groupId === o.groupId);
                    const expanded = !!expandedGroups[o.groupId];
                    const totalAmount = members.reduce((s, m) => s + (parseFloat(m.amount) || 0), 0);
                    const totalCosts = members.reduce((s, m) => s + (m.totalCosts || 0), 0);
                    rendered.push(
                      <tr key={`grp-${o.groupId}`}
                        style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)', cursor: 'pointer' }}
                        onClick={() => setExpandedGroups(g => ({ ...g, [o.groupId]: !g[o.groupId] }))}>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', width: 16, transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 6, color: 'var(--text-3)' }}>▶</span>
                          {o.groupName || 'Group'} <span style={{ fontWeight: 500, color: 'var(--text-3)', fontSize: 12 }}>({members.length})</span>
                        </td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {formatDate(o.fromDate)} – {formatDate(o.toDate)}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#0ea5e9' }}>{o.days}d</td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-2)' }}>
                          {o.countryCode && <img src={flagUrl(o.countryCode)} alt="" width="18" style={{ borderRadius: 2, verticalAlign: 'middle', marginRight: 6 }} />}
                          {o.countryName}{o.cityName ? `, ${o.cityName}` : ''}
                        </td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.perDiem ? `$${o.perDiem}` : '—'}</td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#479c73' }}>${totalAmount.toFixed(2)}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          {totalCosts > 0 ? <span style={{ fontWeight: 700, color: '#f59e0b' }}>${totalCosts.toFixed(2)}</span> : <span style={{ color: 'var(--text-4)' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes || '—'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <button onClick={async (e) => { e.stopPropagation(); if (window.confirm(`Delete entire group (${members.length} trips)?`)) { for (const m of members) { try { await api.delete(`/business-trips/${m.id}`); } catch {} } await load(); } }}
                            style={actionBtn} onMouseEnter={e => e.currentTarget.style.color = '#f87171'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}><DeleteIcon /></button>
                        </td>
                      </tr>
                    );
                    if (expanded) {
                      for (const m of members) {
                        rendered.push(
                          <tr key={m.id} style={{ borderBottom: '1px solid var(--border-2)', background: 'rgba(14,165,233,0.04)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(14,165,233,0.10)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(14,165,233,0.04)'}>
                            <td style={{ padding: '9px 14px 9px 38px', fontWeight: 500, color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: 12 }}>↳ {m.empName}</td>
                            <td style={{ padding: '9px 14px', color: 'var(--text-3)', whiteSpace: 'nowrap', fontSize: 12 }}>{formatDate(m.fromDate)} – {formatDate(m.toDate)}</td>
                            <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0ea5e9', fontSize: 12 }}>{m.days}d</td>
                            <td style={{ padding: '9px 14px', color: 'var(--text-3)', fontSize: 12 }}>{m.countryName}{m.cityName ? `, ${m.cityName}` : ''}</td>
                            <td style={{ padding: '9px 14px', color: 'var(--text-3)', fontSize: 12 }}>{m.perDiem ? `$${m.perDiem}` : '—'}</td>
                            <td style={{ padding: '9px 14px', fontWeight: 600, color: '#479c73', fontSize: 12 }}>{m.amount ? `$${m.amount}` : '—'}</td>
                            <td style={{ padding: '9px 14px', fontSize: 12 }}>
                              {m.totalCosts > 0 ? <span style={{ fontWeight: 600, color: '#f59e0b' }}>${m.totalCosts.toFixed(2)}</span> : <span style={{ color: 'var(--text-4)' }}>—</span>}
                            </td>
                            <td style={{ padding: '9px 14px', color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{m.notes || '—'}</td>
                            <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <RowActionsMenu
                                  onCopy={() => openCopy(m)}
                                  onEdit={() => openEdit(m)}
                                  onDetails={() => setDetailsFor(m)}
                                  onDelete={() => remove(m.id)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      }
                    }
                  } else {
                    rendered.push(
                      <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{o.empName}</td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {formatDate(o.fromDate)} – {formatDate(o.toDate)}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#0ea5e9' }}>{o.days}d</td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-2)' }}>
                          {o.countryCode && <img src={flagUrl(o.countryCode)} alt="" width="18" style={{ borderRadius: 2, verticalAlign: 'middle', marginRight: 6 }} />}
                          {o.countryName}{o.cityName ? `, ${o.cityName}` : ''}
                        </td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.perDiem ? `$${o.perDiem}` : '—'}</td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#479c73' }}>{o.amount ? `$${o.amount}` : '—'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          {o.totalCosts > 0 ? <span style={{ fontWeight: 700, color: '#f59e0b' }}>${o.totalCosts.toFixed(2)}</span> : <span style={{ color: 'var(--text-4)' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes || '—'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <RowActionsMenu
                              onCopy={() => openCopy(o)}
                              onEdit={() => openEdit(o)}
                              onDetails={() => setDetailsFor(o)}
                              onDelete={() => remove(o.id)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  }
                }
                return rendered;
              })()}
            </tbody>
          </table>
        )}
      </div>

      {detailsFor && (
        <DetailsModal
          title="Business Trip"
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: 'Employee', value: detailsFor.empName },
            { label: 'Period', value: `${formatDate(detailsFor.fromDate)} – ${formatDate(detailsFor.toDate)}` },
            { label: 'Days', value: detailsFor.days ? `${detailsFor.days}d` : null },
            { label: 'Destination', value: [detailsFor.countryName, detailsFor.cityName].filter(Boolean).join(', ') },
            { label: 'Per Diem/day', value: detailsFor.perDiem ? `$${detailsFor.perDiem}` : null },
            { label: 'Amount', value: detailsFor.amount ? `$${detailsFor.amount}` : null },
            { label: 'Notes', value: detailsFor.notes },
          ]}
        />
      )}

      {showForm && (
        <SubTabModal title={editing ? 'Edit Business Trip' : 'New Business Trip'} onClose={close}>
          {/* Inner tab switcher */}
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 8, padding: 3, marginBottom: 20, width: 'fit-content' }}>
            {MODAL_TABS.map(tab => (
              <button key={tab.key} type="button" onClick={() => setModalTab(tab.key)}
                disabled={tab.key === 'costs' && !editing}
                style={{
                  padding: '6px 18px', border: 'none', borderRadius: 6,
                  fontWeight: 600, fontSize: 13, cursor: tab.key === 'costs' && !editing ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  background: modalTab === tab.key ? 'var(--surface)' : 'transparent',
                  color: tab.key === 'costs' && !editing ? 'var(--text-4)' : modalTab === tab.key ? 'var(--text)' : 'var(--text-3)',
                  boxShadow: modalTab === tab.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}>
                {tab.label}
                {tab.key === 'costs' && !editing && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.6 }}>(save first)</span>}
              </button>
            ))}
          </div>

          {/* Details tab */}
          {modalTab === 'details' && (
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ ...LABEL, marginBottom: 0 }}>Employee *</label>
                    {!editing && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none' }}>
                        Group
                        <span style={{ position: 'relative', display: 'inline-block', width: 32, height: 18 }}>
                          <input type="checkbox" checked={form.isGroup}
                            onChange={e => setForm(f => ({ ...f, isGroup: e.target.checked, employeeId: '', employeeIds: [] }))}
                            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: form.isGroup ? '#0ea5e9' : 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 18, transition: '0.2s' }}>
                            <span style={{ position: 'absolute', height: 12, width: 12, left: form.isGroup ? 17 : 3, top: 2, background: '#fff', borderRadius: '50%', transition: '0.2s' }} />
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {!form.isGroup ? (
                      <>
                      <EmployeeSearchSelect employees={employees} value={form.employeeId} required onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} />
                      </>
                    ) : (
                      <>
                      <input type="text" value={form.groupName}
                        onChange={e => setForm(f => ({ ...f, groupName: e.target.value }))}
                        placeholder="Group name (e.g. Tbilisi Conference)"
                        style={INPUT} />
                      <div ref={empRef} style={{ position: 'relative' }}>
                        <button type="button" onClick={() => setEmpOpen(v => !v)}
                          style={{ ...INPUT, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
                          {form.employeeIds.length === 0
                            ? <span style={{ color: 'var(--text-3)' }}>— Select employees —</span>
                            : <span>{form.employeeIds.length} selected</span>
                          }
                          <svg style={{ marginLeft: 'auto', flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                        {empOpen && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', overflow: 'hidden', marginTop: 4 }}>
                            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-2)' }}>
                              <input autoFocus type="text" placeholder="Search employees…" value={empSearch}
                                onChange={e => setEmpSearch(e.target.value)}
                                style={{ ...INPUT, padding: '7px 10px', fontSize: 12 }} />
                            </div>
                            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                              {employees
                                .filter(emp => {
                                  if (!empSearch) return true;
                                  const full = `${emp.first_name} ${emp.last_name}`.toLowerCase();
                                  return full.includes(empSearch.toLowerCase());
                                })
                                .map(emp => {
                                  const checked = form.employeeIds.includes(emp.id);
                                  return (
                                    <label key={emp.id}
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: checked ? 'rgba(14,165,233,0.12)' : 'transparent', color: 'var(--text)', fontSize: 13 }}
                                      onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--surface-2)'; }}
                                      onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                                      <input type="checkbox" checked={checked}
                                        onChange={() => setForm(f => ({
                                          ...f,
                                          employeeIds: checked
                                            ? f.employeeIds.filter(x => x !== emp.id)
                                            : [...f.employeeIds, emp.id]
                                        }))} />
                                      <span style={{ flex: 1 }}>{emp.first_name} {emp.last_name}</span>
                                    </label>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                      </>
                    )}
                  </div>
                </div>

                <ImmediateEffectToggle value={form.immediateEffect} onToggle={v => { const eom = endOfMonth(currentMonthStr()); setForm(f => ({ ...f, immediateEffect: v, fromDate: v ? f.fromDate : eom, toDate: v ? f.toDate : eom })); }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>From *</label>
                    <input type="date" value={form.fromDate} onChange={e => setForm(f => ({ ...f, fromDate: e.target.value }))} style={{ ...INPUT, colorScheme: 'dark' }} required />
                  </div>
                  <div>
                    <label style={LABEL}>To *</label>
                    <input type="date" value={form.toDate} min={form.fromDate} onChange={e => setForm(f => ({ ...f, toDate: e.target.value }))} style={{ ...INPUT, colorScheme: 'dark' }} required />
                  </div>
                </div>
                {days > 0 && (
                  <div style={{ marginTop: -8, padding: '8px 12px', background: 'rgba(14,165,233,0.1)', borderRadius: 8, fontSize: 13, color: '#0ea5e9', fontWeight: 600 }}>
                    ✈️ {days} day{days !== 1 ? 's' : ''}
                  </div>
                )}

                <div>
                  <label style={LABEL}>Country *</label>
                  <div ref={countryRef} style={{ position: 'relative' }}>
                    <button type="button" onClick={() => setCountryOpen(v => !v)}
                      style={{ ...INPUT, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
                      {form.countryCode
                        ? <><img src={flagUrl(form.countryCode)} alt="" width="20" style={{ borderRadius: 2, flexShrink: 0 }} />{form.countryName}</>
                        : <span style={{ color: 'var(--text-3)' }}>— Select country —</span>
                      }
                      <svg style={{ marginLeft: 'auto', flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    {countryOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', overflow: 'hidden', marginTop: 4 }}>
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-2)' }}>
                          <input autoFocus type="text" placeholder="Search country…" value={countrySearch}
                            onChange={e => setCountrySearch(e.target.value)}
                            style={{ ...INPUT, padding: '7px 10px', fontSize: 12 }} />
                        </div>
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {filteredCountries.length === 0
                            ? <div style={{ padding: '12px 14px', color: 'var(--text-3)', fontSize: 13 }}>No countries found</div>
                            : filteredCountries.map(c => (
                              <button key={c.code} type="button" onClick={() => selectCountry(c)}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', background: form.countryCode === c.code ? 'rgba(14,165,233,0.12)' : 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                                onMouseEnter={e => { if (form.countryCode !== c.code) e.currentTarget.style.background = 'var(--surface-2)'; }}
                                onMouseLeave={e => { if (form.countryCode !== c.code) e.currentTarget.style.background = 'transparent'; }}>
                                <img src={flagUrl(c.code)} alt="" width="20" style={{ borderRadius: 2, flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>{c.name}</span>
                                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>${c.perDiem}/day</span>
                              </button>
                            ))
                          }
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {form.countryCode && (() => {
                  const countryObj = COUNTRIES.find(c => c.code === form.countryCode);
                  const cities = countryObj?.cities || [];
                  const filteredCities = citySearch ? cities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase())) : cities;
                  
                  return (
                  <div>
                    <label style={LABEL}>City</label>
                    <div ref={cityRef} style={{ position: 'relative' }}>
                      <input type="text" value={form.cityName} 
                        onChange={e => {
                          const val = e.target.value;
                          setForm(f => {
                            const cPerDiem = countryObj?.perDiem || 0;
                            return { ...f, cityName: val, perDiem: String(cPerDiem), amount: (cPerDiem * calcDays(f.fromDate, f.toDate)).toFixed(2) };
                          });
                          setCitySearch(val);
                          if (!cityOpen) setCityOpen(true);
                        }}
                        onFocus={() => { if (cities.length > 0) setCityOpen(true); setCitySearch(form.cityName); }}
                        placeholder={`City in ${form.countryName}…`} style={INPUT} />
                      {cityOpen && cities.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', overflow: 'hidden', marginTop: 4 }}>
                          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            {filteredCities.length === 0
                              ? <div style={{ padding: '12px 14px', color: 'var(--text-3)', fontSize: 13 }}>Using custom city</div>
                              : filteredCities.map(c => (
                                <button key={c.name} type="button" onClick={() => selectCity(c)}
                                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', background: form.cityName === c.name ? 'rgba(14,165,233,0.12)' : 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                                  onMouseEnter={e => { if (form.cityName !== c.name) e.currentTarget.style.background = 'var(--surface-2)'; }}
                                  onMouseLeave={e => { if (form.cityName !== c.name) e.currentTarget.style.background = 'transparent'; }}>
                                  <span style={{ flex: 1 }}>{c.name}</span>
                                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>${c.perDiem}/day</span>
                                </button>
                              ))
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )})()}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Per Diem (USD/day)</label>
                    <input type="number" min="0" step="0.01" value={form.perDiem}
                      onChange={e => setForm(f => ({ ...f, perDiem: e.target.value }))}
                      placeholder="Auto-filled by country"
                      style={{ ...INPUT, background: form.countryCode ? 'rgba(14,165,233,0.07)' : INPUT.background }} />
                  </div>
                  <div>
                    <label style={LABEL}>
                      Amount (USD)
                      {autoAmount && !form.amount && <span style={{ fontSize: 11, color: '#0ea5e9', marginLeft: 6 }}>auto: ${autoAmount}</span>}
                    </label>
                    <input type="number" min="0" step="0.01" value={form.amount}
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                      placeholder={autoAmount || 'e.g. 325.00'}
                      style={INPUT} />
                  </div>
                </div>

                <div>
                  <label style={LABEL}>Note</label>
                  <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note…" style={INPUT} />
                </div>
              </div>
              <SubTabActions onCancel={close} saving={saving} disabled={(form.isGroup ? form.employeeIds.length === 0 : !form.employeeId) || !form.fromDate || !form.toDate || !form.countryCode} />
            </form>
          )}

          {/* Costs tab */}
          {modalTab === 'costs' && editing && (
            <TripCosts tripId={editing} onCostsChanged={load} />
          )}
        </SubTabModal>
      )}
    </div>
  );
}

// ── Advance Payment Tab ───────────────────────────────────────────────────────
function AdvancePaymentTab({ employees, gelRate, eurRate, registerAdd }) {
  const { t } = useLanguage();
  const { orders, add, update, remove } = useLocalOrders('hr_advance_payment_orders', o => employees.some(e => e.id === o.employeeId));
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toUSD = (amount, currency) => {
    const val = parseFloat(amount);
    if (currency === 'GEL' && gelRate) return Math.round((val / gelRate) * 100) / 100;
    if (currency === 'EUR' && eurRate) return Math.round((val / eurRate) * 100) / 100;
    return val;
  };
  // Transfers are tracked in GEL (no per-record currency field) -- convert
  // via USD as the common intermediate so USD/EUR advances still post a
  // sensible GEL amount to the transfer queue.
  const toGEL = (amount, currency) => {
    if (currency === 'GEL') return parseFloat(amount);
    const usd = toUSD(amount, currency);
    return gelRate ? Math.round(usd * gelRate * 100) / 100 : usd;
  };

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const nearestDate = endOfMonth(currentMonthStr());

  const EMPTY = {
    employeeId: '',
    currency: '',
    mode: 'automatic',
    totalAmount: '',
    numMonths: 1,
    startMonth: thisMonth,
    manualSlots: Array.from({ length: 1 }, () => ({ amount: '' })),
    samePeriodMonth: thisMonth,
    samePeriodAmount: '',
    includeInSalary: true,
    autoDate: true,
    dueDate: '',
  };
  const [form, setForm] = useState(EMPTY);
  const [samePeriodSalary, setSamePeriodSalary] = useState(null); // net salary for employee+samePeriodMonth
  const [samePeriodLoading, setSamePeriodLoading] = useState(false);

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Last 4 selectable pay periods for "Same Period": current month + next 3.
  const samePeriodOptions = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    if (form.mode !== 'sameperiod' || !form.employeeId || !form.samePeriodMonth) { setSamePeriodSalary(null); return; }
    let cancelled = false;
    setSamePeriodLoading(true);
    api.get(`/salaries?month=${form.samePeriodMonth}`)
      .then(res => {
        if (cancelled) return;
        const match = (res.data.salaries || []).find(s => String(s.employee.id) === String(form.employeeId));
        setSamePeriodSalary(match ? match.net_salary : null);
      })
      .catch(() => { if (!cancelled) setSamePeriodSalary(null); })
      .finally(() => { if (!cancelled) setSamePeriodLoading(false); });
    return () => { cancelled = true; };
  }, [form.mode, form.employeeId, form.samePeriodMonth]);

  // net_salary from /api/salaries is in USD; convert the entered amount (in
  // form.currency) to USD before comparing so the remaining balance is accurate.
  const samePeriodRemaining = (samePeriodSalary != null && form.samePeriodAmount)
    ? Math.round((parseFloat(samePeriodSalary) - toUSD(form.samePeriodAmount, form.currency)) * 100) / 100
    : null;

  const autoInstallment = (() => {
    const total = parseFloat(form.totalAmount);
    if (!total || form.numMonths < 1) return '';
    return (total / form.numMonths).toFixed(2);
  })();

  const manualTotal = form.manualSlots.reduce((s, sl) => s + (parseFloat(sl.amount) || 0), 0);

  const getMonthLabel = (startMonth, offset) => {
    const [y, m] = startMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + offset, 1);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };

  const handleNumMonths = (n) => {
    const count = Math.max(1, Math.min(12, Number(n)));
    setForm(p => ({
      ...p,
      numMonths: count,
      manualSlots: Array.from({ length: count }, (_, i) => ({ amount: p.manualSlots[i]?.amount || '' })),
    }));
  };

  const updateSlot = (i, val) => {
    setForm(p => {
      const slots = [...p.manualSlots];
      slots[i] = { amount: val };
      return { ...p, manualSlots: slots };
    });
  };

  const canSave = form.employeeId && !!form.currency && (
    form.mode === 'automatic'
      ? parseFloat(form.totalAmount) > 0
      : form.mode === 'manual'
      ? form.manualSlots.some(s => parseFloat(s.amount) > 0)
      : parseFloat(form.samePeriodAmount) > 0 && !!form.samePeriodMonth
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const emp = employees.find(x => String(x.id) === String(form.employeeId));
    const empName = emp ? `${emp.first_name} ${emp.last_name}` : '';

    const schedule = form.mode === 'sameperiod'
      ? [{ month: form.samePeriodMonth, amount: parseFloat(form.samePeriodAmount) || 0 }]
      : Array.from({ length: form.numMonths }, (_, i) => ({
          month: (() => {
            const [y, m] = form.startMonth.split('-').map(Number);
            const d = new Date(y, m - 1 + i, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          })(),
          amount: form.mode === 'automatic'
            ? parseFloat(autoInstallment)
            : parseFloat(form.manualSlots[i]?.amount) || 0,
        }));
    const total = form.mode === 'automatic' ? parseFloat(form.totalAmount)
      : form.mode === 'sameperiod' ? (parseFloat(form.samePeriodAmount) || 0)
      : manualTotal;

    const createdIds = [];
    try {
      // Editing: remove the previously created deduction units before posting
      // the (possibly changed) new ones, so payroll never double-counts.
      if (editId) {
        const existing = orders.find(o => o.id === editId);
        if (existing?.unitIds?.length) {
          await Promise.all(existing.unitIds.map(uid =>
            api.delete(`/employees/${existing.employeeId}/units/${uid}`).catch(() => {})
          ));
        }
      }

      await Promise.all(schedule.map(async ({ month, amount }) => {
        if (!amount) return;
        const [y, m] = month.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const date = `${month}-${String(lastDay).padStart(2, '0')}`;
        const res = await api.post(`/employees/${form.employeeId}/units`, {
          type: 'Advance',
          amount: toUSD(amount, form.currency),
          date,
          currency: 'USD',
          include_in_salary: form.includeInSalary,
        });
        if (res.data?.unit?.id) createdIds.push(res.data.unit.id);
      }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create salary deductions.');
      setSaving(false);
      return;
    }

    // New advances also queue a Transfer so finance sees it needs to be paid
    // out, and gets notified -- editing an existing advance doesn't re-queue
    // one, since it may already be approved/paid.
    if (!editId) {
      const modeLabel = form.mode === 'automatic' ? 'ავტომატური განაწილება'
        : form.mode === 'manual' ? 'ხელით განაწილება'
        : 'იმავე პერიოდში დაქვითვა';
      try {
        await api.post('/accounting/auto-transfers', {
          client_name: empName,
          amount: toGEL(total, form.currency),
          due_date: form.autoDate ? nearestDate : (form.dueDate || nearestDate),
          description: `ავანსის გადარიცხვა — ${modeLabel}`,
          iban: emp?.account_number || null,
        });
      } catch (transferErr) {
        console.error('Failed to queue advance transfer:', transferErr);
        window.alert(`ავანსი შენახულია, მაგრამ გადარიცხვის ავტომატურად შექმნა ვერ მოხერხდა: ${transferErr.response?.data?.error || transferErr.message}\n\nგთხოვთ, გადარიცხვა ხელით შექმნათ Transfers-ში.`);
      }
    }

    const row = { employeeId: form.employeeId, empName, currency: form.currency, mode: form.mode, total, schedule, includeInSalary: form.includeInSalary, unitIds: createdIds };
    if (editId) update(editId, row);
    else add(row);
    setShowForm(false);
    setForm(EMPTY);
    setEditId(null);
    setSaving(false);
  };

  const openEdit = (o) => {
    setEditId(o.id);
    setForm({
      employeeId: o.employeeId,
      currency: o.currency || 'GEL',
      mode: o.mode || 'automatic',
      totalAmount: o.mode === 'automatic' ? String(o.total ?? '') : '',
      numMonths: o.mode !== 'sameperiod' ? (o.schedule?.length || 1) : 1,
      startMonth: o.mode !== 'sameperiod' ? (o.schedule?.[0]?.month || thisMonth) : thisMonth,
      manualSlots: o.mode === 'manual' && o.schedule?.length
        ? o.schedule.map(s => ({ amount: String(s.amount ?? '') }))
        : [{ amount: '' }],
      samePeriodMonth: o.mode === 'sameperiod' ? (o.schedule?.[0]?.month || thisMonth) : thisMonth,
      samePeriodAmount: o.mode === 'sameperiod' ? String(o.schedule?.[0]?.amount ?? '') : '',
      includeInSalary: o.includeInSalary !== false,
      autoDate: true,
      dueDate: '',
    });
    setShowForm(true);
    setError('');
  };

  const openCopy = (o) => {
    setEditId(null);
    setForm({
      employeeId: o.employeeId,
      currency: o.currency || 'GEL',
      mode: o.mode || 'automatic',
      totalAmount: o.mode === 'automatic' ? String(o.total ?? '') : '',
      numMonths: o.mode !== 'sameperiod' ? (o.schedule?.length || 1) : 1,
      startMonth: thisMonth,
      manualSlots: o.mode === 'manual' && o.schedule?.length
        ? o.schedule.map(s => ({ amount: String(s.amount ?? '') }))
        : [{ amount: '' }],
      samePeriodMonth: thisMonth,
      samePeriodAmount: o.mode === 'sameperiod' ? String(o.schedule?.[0]?.amount ?? '') : '',
      includeInSalary: o.includeInSalary !== false,
      autoDate: true,
      dueDate: '',
    });
    setShowForm(true);
    setError('');
  };

  const handleRemove = async (o) => {
    if (!window.confirm('Delete this advance payment?')) return;
    if (o.unitIds?.length) {
      await Promise.all(o.unitIds.map(uid =>
        api.delete(`/employees/${o.employeeId}/units/${uid}`).catch(() => {})
      ));
    }
    remove(o.id);
  };

  const [detailsFor, setDetailsFor] = useState(null);
  const CURR_SYMBOLS = { GEL: '₾', USD: '$', EUR: '€' };

  const openAdd = () => { setEditId(null); setForm(EMPTY); setShowForm(true); };
  useEffect(() => { if (registerAdd) registerAdd.current = openAdd; });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(orders, [
          { header: 'Date', get: o => o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '' },
          { header: 'Employee', get: o => o.empName || '' },
          { header: 'Total', get: o => o.total || '' },
          { header: 'Currency', get: o => o.currency || '' },
          { header: 'Mode', get: o => o.mode || '' },
          { header: 'Include in Salary', get: o => o.includeInSalary !== false ? 'Yes' : 'No' },
          { header: 'Schedule', get: o => (o.schedule || []).map(s => `${s.month}: ${s.amount}`).join('; ') },
        ], 'Advance Payment', 'Advance-Payment-Orders')} />}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {orders.length === 0 ? (
          <EmptyState label="Advance Payment" onAdd={openAdd} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['Date', 'Employee', 'Total', 'Currency', 'Mode', 'ჩარიცხულია', 'Months', 'Schedule', ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)', cursor: 'pointer' }}
                  onClick={openRowMenu}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)' }}>{o.empName}</td>
                  <td style={{ padding: '11px 14px', color: '#479c73', fontWeight: 600 }}>{CURR_SYMBOLS[o.currency]}{Number(o.total).toFixed(2)}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.currency}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: o.mode === 'automatic' ? 'rgba(59,130,246,0.12)' : o.mode === 'sameperiod' ? 'rgba(71,156,115,0.12)' : 'rgba(139,92,246,0.12)',
                      color: o.mode === 'automatic' ? '#60a5fa' : o.mode === 'sameperiod' ? '#479c73' : '#a78bfa',
                    }}>
                      {o.mode === 'automatic' ? 'Auto' : o.mode === 'sameperiod' ? 'Same Period' : 'Manual'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: o.includeInSalary !== false ? 'rgba(71,156,115,0.12)' : 'rgba(148,163,184,0.15)',
                      color: o.includeInSalary !== false ? '#479c73' : 'var(--text-3)',
                    }}>
                      {o.includeInSalary !== false ? '✓ ჩარიცხულია' : 'არ არის ჩარიცხული'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.schedule?.length || 0}</td>
                  <td style={{ padding: '11px 14px', maxWidth: 260 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(o.schedule || []).map((s, i) => (
                        <span key={i} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>
                          {s.month} · {CURR_SYMBOLS[o.currency]}{Number(s.amount).toFixed(0)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <RowActionsMenu
                        onCopy={() => openCopy(o)}
                        onEdit={() => openEdit(o)}
                        onDetails={() => setDetailsFor(o)}
                        onDelete={() => handleRemove(o)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detailsFor && (
        <DetailsModal
          title="Advance Payment"
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: 'Date', value: new Date(detailsFor.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: 'Employee', value: detailsFor.empName },
            { label: 'Total', value: `${CURR_SYMBOLS[detailsFor.currency]}${Number(detailsFor.total).toFixed(2)}` },
            { label: 'Currency', value: detailsFor.currency },
            { label: 'Mode', value: detailsFor.mode === 'automatic' ? 'Auto' : detailsFor.mode === 'sameperiod' ? 'Same Period' : 'Manual' },
            { label: 'ჩარიცხულია', value: detailsFor.includeInSalary !== false ? '✓' : 'არა' },
            { label: 'Schedule', value: (detailsFor.schedule || []).map(s => `${s.month}: ${CURR_SYMBOLS[detailsFor.currency]}${Number(s.amount).toFixed(0)}`).join(', ') },
          ]}
        />
      )}

      {showForm && (
        <SubTabModal title={editId ? 'Edit Advance Payment' : 'Advance Payment'} onClose={() => { setShowForm(false); setEditId(null); setError(''); }} maxWidth={680}>
          <form onSubmit={handleSubmit}>

            {/* Employee */}
            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>Employee</label>
              <EmployeeSearchSelect employees={employees} value={form.employeeId} required onChange={e => setField('employeeId', e.target.value)} />
            </div>

            {/* Mode toggle */}
            <div style={{ marginBottom: 18 }}>
              <label style={LABEL}>Schedule Mode</label>
              <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 9, padding: 3, gap: 3 }}>
                {['automatic', 'manual', 'sameperiod'].map(m => (
                  <button key={m} type="button" onClick={() => setField('mode', m)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s', background: form.mode === m ? 'var(--surface)' : 'transparent', color: form.mode === m ? 'var(--text)' : 'var(--text-3)', boxShadow: form.mode === m ? '0 1px 4px rgba(0,0,0,0.12)' : 'none' }}>
                    {m === 'automatic' ? 'Automatic' : m === 'manual' ? 'Manual' : 'Same Period'}
                  </button>
                ))}
              </div>
            </div>

            {/* Transfer date */}
            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>{t('orders.transferDate')}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={form.autoDate}
                  onChange={e => setForm(p => ({ ...p, autoDate: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                {t('orders.nearestTransferDate')} · {new Date(nearestDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </label>
              {!form.autoDate && (
                <input
                  type="date"
                  value={form.dueDate || nearestDate}
                  onChange={e => setField('dueDate', e.target.value)}
                  style={{ ...INPUT, marginTop: 8 }}
                />
              )}
            </div>

            {/* Start month + num months (automatic/manual only) */}
            {form.mode !== 'sameperiod' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={LABEL}>Start Month</label>
                  <input type="month" value={form.startMonth} onChange={e => setField('startMonth', e.target.value)} style={{ ...INPUT, colorScheme: 'dark' }} />
                </div>
                <div>
                  <label style={LABEL}>Number of Months (max 12)</label>
                  <input type="number" min={1} max={12} value={form.numMonths}
                    onChange={e => handleNumMonths(e.target.value)} style={INPUT} />
                </div>
              </div>
            )}

            {/* SAME PERIOD mode */}
            {form.mode === 'sameperiod' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={LABEL}>Total Amount</label>
                    <input type="number" min={0} step="0.01" value={form.samePeriodAmount}
                      onChange={e => setField('samePeriodAmount', e.target.value)}
                      placeholder="e.g. 400" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Currency</label>
                    <select value={form.currency} onChange={e => setField('currency', e.target.value)} required style={INPUT}>
                      <option value="">— Select currency —</option>
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={LABEL}>Deduct From Salary</label>
                  <select value={form.samePeriodMonth} onChange={e => setField('samePeriodMonth', e.target.value)} style={INPUT}>
                    {samePeriodOptions.map((m, i) => (
                      <option key={m} value={m}>{getMonthLabel(m, 0)}{i === 0 ? ' (current)' : ''}</option>
                    ))}
                  </select>
                </div>

                {form.employeeId && (
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    {samePeriodLoading ? (
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Loading salary…</div>
                    ) : samePeriodSalary != null ? (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                          {getMonthLabel(form.samePeriodMonth, 0)} salary: <strong style={{ color: 'var(--text)' }}>${Number(samePeriodSalary).toFixed(2)}</strong>
                        </div>
                        {samePeriodRemaining != null && (
                          <div style={{ fontSize: 13, marginTop: 6 }}>
                            Remaining after advance:{' '}
                            <strong style={{ color: samePeriodRemaining >= 0 ? '#479c73' : '#f87171' }}>
                              ${samePeriodRemaining.toFixed(2)}
                            </strong>
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No salary data found for this employee/month.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* AUTOMATIC mode */}
            {form.mode === 'automatic' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Total Amount</label>
                    <input type="number" min={0} step="0.01" value={form.totalAmount}
                      onChange={e => setField('totalAmount', e.target.value)}
                      placeholder="e.g. 4000" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Currency</label>
                    <select value={form.currency} onChange={e => setField('currency', e.target.value)} required style={INPUT}>
                      <option value="">— Select currency —</option>
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                    </select>
                  </div>
                </div>
                {autoInstallment && (
                  <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 600 }}>PAYMENT SCHEDULE</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {Array.from({ length: form.numMonths }, (_, i) => (
                        <div key={i} style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border-2)', fontSize: 12, color: 'var(--text-2)' }}>
                          {getMonthLabel(form.startMonth, i)} · <strong style={{ color: 'var(--text)' }}>{CURR_SYMBOLS[form.currency]}{autoInstallment}</strong>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
                      Total: <strong style={{ color: '#479c73' }}>{CURR_SYMBOLS[form.currency]}{parseFloat(form.totalAmount).toFixed(2)}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MANUAL mode */}
            {form.mode === 'manual' && (
              <div style={{ marginBottom: 16 }}>
                <label style={LABEL}>Monthly Amounts</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {form.manualSlots.map((slot, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)', width: 80, flexShrink: 0 }}>{getMonthLabel(form.startMonth, i)}</span>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 13 }}>{CURR_SYMBOLS[form.currency]}</span>
                        <input type="number" min={0} step="0.01" value={slot.amount}
                          onChange={e => updateSlot(i, e.target.value)}
                          placeholder="0.00"
                          style={{ ...INPUT, paddingLeft: 28 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={LABEL}>Currency</label>
                  <select value={form.currency} onChange={e => setField('currency', e.target.value)} required style={INPUT}>
                    <option value="">— Select currency —</option>
                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                  </select>
                </div>
                {manualTotal > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)', textAlign: 'right' }}>
                    Total: <strong style={{ color: '#479c73' }}>{CURR_SYMBOLS[form.currency]}{manualTotal.toFixed(2)}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Credited toggle — only deduct from salary once the advance has actually been paid out */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 4, padding: '12px 14px', borderRadius: 9, border: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>ჩარიცხულია</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {form.includeInSalary ? 'ავანსი გამოაკლდება ხელფასს' : 'ავანსი ჯერ არ არის ჩარიცხული — ხელფასს არ დააკლდება'}
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
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  display: 'block',
                }} />
              </button>
            </div>

            {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8, marginBottom: 0 }}>{error}</p>}
            <SubTabActions onCancel={() => { setShowForm(false); setEditId(null); setError(''); }} saving={saving} disabled={!canSave} />
          </form>
        </SubTabModal>
      )}
    </div>
  );
}

// ── Bonus Tab (bulk upload) ─────────────────────────────────────────────────────
function BonusTab({ employees, gelRate, eurRate, registerAdd }) {
  const { t } = useLanguage();
  const { orders: localOrders, add, update, remove } = useLocalOrders('hr_bonus_orders', o => (o.entries || []).some(en => employees.some(e => e.id === en.employeeId)));
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [bulkSummary, setBulkSummary] = useState(null);
  const bulkFileRef = useRef(null);

  // Any bonus-type unit created elsewhere (e.g. the Adjusting tab, or via a custom
  // bonus unit type) won't be in this tab's local batch log — pull those in live
  // so every bonus shows here regardless of how it was created.
  const [liveUnits, setLiveUnits] = useState([]);
  const [liveLoadFailed, setLiveLoadFailed] = useState(false);
  const loadLiveUnits = async () => {
    setLiveLoadFailed(false);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await api.get('/employees/units/all');
        const units = res.data?.units || [];
        setLiveUnits(units.filter(u => u.type === 'Bonus' || /ბონუს/i.test(u.type || '')));
        return;
      } catch (err) {
        if (attempt === 2) {
          console.error('Failed to load bonus units:', err);
          setLiveLoadFailed(true);
        } else {
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
      }
    }
  };
  useEffect(() => { loadLiveUnits(); }, []);

  const localUnitIds = new Set(localOrders.flatMap(o => (o.entries || []).map(en => en.unitId).filter(Boolean)));
  const liveOnlyByMonth = {};
  liveUnits
    .filter(u => !localUnitIds.has(u.id))
    .forEach(u => {
      const month = (u.date || '').slice(0, 7);
      if (!liveOnlyByMonth[month]) {
        liveOnlyByMonth[month] = { id: `live-${month}`, month, currency: 'USD', purpose: '', entries: [], total: 0, createdAt: u.created_at, _live: true };
      }
      const grp = liveOnlyByMonth[month];
      grp.entries.push({ employeeId: u.employee_id, empName: u.employee ? `${u.employee.first_name} ${u.employee.last_name}` : '', amount: u.amount, unitId: u.id });
      grp.total += parseFloat(u.amount) || 0;
      if (u.note && !grp.purpose) grp.purpose = u.note;
      if (new Date(u.created_at) > new Date(grp.createdAt)) grp.createdAt = u.created_at;
    });
  const liveOnlyRows = Object.values(liveOnlyByMonth);
  const orders = [...localOrders, ...liveOnlyRows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const toUSD = (amount, currency) => {
    const val = parseFloat(amount);
    if (currency === 'GEL' && gelRate) return Math.round((val / gelRate) * 100) / 100;
    if (currency === 'EUR' && eurRate) return Math.round((val / eurRate) * 100) / 100;
    return val;
  };
  // A transfer for each bonus (always positive) is queued automatically
  // server-side (see createEmployeeUnit) -- no client-side call needed here.

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const EMPTY = { month: thisMonth, currency: '', purpose: '', selections: {}, autoDate: true, dueDate: '' }; // selections: { [employeeId]: amountString }
  const [form, setForm] = useState(EMPTY);

  const toggleEmp = (empId) => {
    setForm(p => {
      const next = { ...p.selections };
      if (Object.prototype.hasOwnProperty.call(next, empId)) delete next[empId];
      else next[empId] = '';
      return { ...p, selections: next };
    });
  };

  const setAmount = (empId, val) => setForm(p => ({ ...p, selections: { ...p.selections, [empId]: val } }));

  const selectedIds = Object.keys(form.selections);
  const selectedTotal = selectedIds.reduce((s, id) => s + (parseFloat(form.selections[id]) || 0), 0);
  const canSave = !!form.month && !!form.currency && selectedIds.some(id => parseFloat(form.selections[id]) > 0);

  const filteredEmployees = employees.filter(e =>
    `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  const downloadBulkTemplate = () => {
    const headers = ['Personal ID', 'First Name', 'Last Name', 'Amount'];
    const exampleRows = employees.slice(0, 3).map(e => [e.personal_id || '', e.first_name || '', e.last_name || '', '']);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
    ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bonuses');
    XLSX.writeFile(wb, 'Bonus_Upload_Template.xlsx');
  };

  const handleBulkUpload = (e) => {
    const file = e.target.files[0];
    if (bulkFileRef.current) bulkFileRef.current.value = '';
    if (!file) return;
    setBulkError(''); setBulkSummary(null);
    if (!form.month || !form.currency) {
      setBulkError('Select Month and Currency above before uploading.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const norm = s => String(s).toLowerCase().replace(/[\s_\-]+/g, '').trim();
        const getVal = (row, ...keys) => {
          const normKeys = keys.map(norm);
          for (const col of Object.keys(row)) {
            if (normKeys.includes(norm(col))) return row[col];
          }
          return '';
        };
        // Excel silently reformats a "Personal ID" cell to a number if it's ever
        // touched (dropping leading zeros, e.g. "010101898636" -> 10101898636),
        // so compare digits-only with leading zeros stripped rather than exact strings.
        const normPid = v => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
        const normName = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        const matched = {};
        const unmatched = [];
        data.forEach((row) => {
          const personalId = String(getVal(row, 'Personal ID', 'PersonalID', 'personal_id') || '').trim();
          const firstName = String(getVal(row, 'First Name', 'FirstName', 'first_name') || '').trim();
          const lastName = String(getVal(row, 'Last Name', 'LastName', 'last_name') || '').trim();
          const amount = parseFloat(getVal(row, 'Amount', 'amount') || 0);
          if (!amount || amount <= 0) return;
          const pidNorm = normPid(personalId);
          let emp = pidNorm ? employees.find(e => normPid(e.personal_id) === pidNorm) : null;
          if (!emp && (firstName || lastName)) {
            emp = employees.find(e => normName(e.first_name) === normName(firstName) && normName(e.last_name) === normName(lastName));
          }
          if (emp) matched[emp.id] = amount;
          else unmatched.push(personalId || `${firstName} ${lastName}`.trim() || '(unknown row)');
        });
        if (Object.keys(matched).length === 0) {
          setBulkError('No rows matched an existing employee. Check Personal ID / First Name / Last Name against your employee list.');
          return;
        }

        setSaving(true);
        const today = new Date().toISOString().slice(0, 10);
        const date = form.autoDate ? today : (form.dueDate || today);
        const createdEntries = [];
        try {
          await Promise.all(Object.entries(matched).map(async ([id, amount]) => {
            const res = await api.post(`/employees/${id}/units`, {
              type: 'Bonus',
              amount: toUSD(amount, form.currency),
              date,
              currency: 'USD',
              include_in_salary: true,
              note: form.purpose || null,
              // Original entered figure, so the auto-queued transfer converts
              // straight from it instead of re-deriving GEL from the already
              // USD-converted amount (a second exchange-rate lookup drifts
              // from what was actually typed in).
              original_amount: amount,
              original_currency: form.currency,
            });
            const emp = employees.find(x => String(x.id) === String(id));
            createdEntries.push({ employeeId: id, empName: emp ? `${emp.first_name} ${emp.last_name}` : '', amount, unitId: res.data?.unit?.id });
          }));
        } catch (err) {
          setBulkError(err.response?.data?.error || 'Failed to create some bonuses.');
          setSaving(false);
          return;
        }

        const total = createdEntries.reduce((s, en) => s + en.amount, 0);
        add({ month: form.month, currency: form.currency, purpose: form.purpose, entries: createdEntries, total });
        setSaving(false);
        setBulkSummary({ createdCount: createdEntries.length, unmatched });
        loadLiveUnits();
      } catch (err) {
        setBulkError('Failed to read file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const openNew = () => { setEditId(null); setForm(EMPTY); setSearch(''); setShowForm(true); setError(''); setBulkError(''); setBulkSummary(null); };
  useEffect(() => { if (registerAdd) registerAdd.current = openNew; });

  const openEdit = (o) => {
    setEditId(o.id);
    const selections = {};
    (o.entries || []).forEach(en => { selections[en.employeeId] = String(en.amount); });
    setForm({ month: o.month, currency: o.currency, purpose: o.purpose || '', selections, autoDate: true, dueDate: '' });
    setSearch('');
    setShowForm(true);
    setError('');
    setBulkError(''); setBulkSummary(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const today = new Date().toISOString().slice(0, 10);
    const date = form.autoDate ? today : (form.dueDate || today);
    const entries = selectedIds
      .map(id => ({ id, amount: parseFloat(form.selections[id]) || 0 }))
      .filter(en => en.amount > 0);

    const createdEntries = [];
    try {
      if (editId) {
        const existing = orders.find(o => o.id === editId);
        if (existing?.entries?.length) {
          await Promise.all(existing.entries.map(en =>
            en.unitId ? api.delete(`/employees/${en.employeeId}/units/${en.unitId}`).catch(() => {}) : Promise.resolve()
          ));
        }
      }
      await Promise.all(entries.map(async ({ id, amount }) => {
        const res = await api.post(`/employees/${id}/units`, {
          type: 'Bonus',
          amount: toUSD(amount, form.currency),
          date,
          currency: 'USD',
          include_in_salary: true,
          note: form.purpose || null,
          original_amount: amount,
          original_currency: form.currency,
          // Editing deletes and recreates the underlying units -- skip
          // re-queuing a transfer for those, the original may already be approved/paid.
          skip_transfer: !!editId,
        });
        const emp = employees.find(x => String(x.id) === String(id));
        createdEntries.push({
          employeeId: id,
          empName: emp ? `${emp.first_name} ${emp.last_name}` : '',
          amount,
          unitId: res.data?.unit?.id,
        });
      }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create bonuses.');
      setSaving(false);
      return;
    }

    const total = createdEntries.reduce((s, en) => s + en.amount, 0);
    const row = { month: form.month, currency: form.currency, purpose: form.purpose, entries: createdEntries, total };
    if (editId) update(editId, row);
    else add(row);

    setShowForm(false);
    setForm(EMPTY);
    setEditId(null);
    setSaving(false);
    loadLiveUnits();
  };

  const openCopy = (o) => {
    setEditId(null);
    const selections = {};
    (o.entries || []).forEach(en => { selections[en.employeeId] = String(en.amount); });
    setForm({ month: o.month, currency: o.currency, purpose: o.purpose || '', selections, autoDate: true, dueDate: '' });
    setSearch('');
    setShowForm(true);
    setError('');
    setBulkError(''); setBulkSummary(null);
  };

  const handleRemove = async (o) => {
    if (!window.confirm('Delete this bonus batch?')) return;
    if (o.entries?.length) {
      await Promise.all(o.entries.map(en =>
        en.unitId ? api.delete(`/employees/${en.employeeId}/units/${en.unitId}`).catch(() => {}) : Promise.resolve()
      ));
    }
    if (o._live) loadLiveUnits();
    else remove(o.id);
  };

  const [detailsFor, setDetailsFor] = useState(null);
  const CURR_SYMBOLS = { GEL: '₾', USD: '$', EUR: '€' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(
          orders.flatMap(o => (o.entries || []).map(en => ({ ...en, month: o.month, currency: o.currency, purpose: o.purpose, createdAt: o.createdAt }))),
          [
            { header: 'Date', get: r => r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB') : '' },
            { header: 'Month', get: r => r.month || '' },
            { header: 'Employee', get: r => r.empName || '' },
            { header: 'Amount', get: r => r.amount || '' },
            { header: 'Currency', get: r => r.currency || '' },
            { header: 'Purpose', get: r => r.purpose || '' },
          ], 'Bonus', 'Bonus-Orders')} />}
      </div>

      {liveLoadFailed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14, borderRadius: 9, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 13 }}>
          Failed to load some bonus records — the list below may be incomplete.
          <button onClick={loadLiveUnits} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #ef4444', borderRadius: 7, color: '#ef4444', fontSize: 12, fontWeight: 600, padding: '4px 10px', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {orders.length === 0 ? (
          <EmptyState label="Bonus" onAdd={openNew} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['Date', 'Month', 'Employees', 'დანიშნულება', 'Total', 'Currency', ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)', cursor: 'pointer' }}
                  onClick={openRowMenu}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{o.month}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 320 }}>
                      {(o.entries || []).map((en, i) => (
                        <span key={i} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>
                          {en.empName} · {CURR_SYMBOLS[o.currency]}{Number(en.amount).toFixed(0)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.purpose || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#479c73', fontWeight: 600 }}>{CURR_SYMBOLS[o.currency]}{Number(o.total).toFixed(2)}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)' }}>{o.currency}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <RowActionsMenu
                        onCopy={() => openCopy(o)}
                        onEdit={o._live ? undefined : () => openEdit(o)}
                        onDetails={() => setDetailsFor(o)}
                        onDelete={() => handleRemove(o)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detailsFor && (
        <DetailsModal
          title="Bonus Batch"
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: 'Date', value: new Date(detailsFor.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: 'Month', value: detailsFor.month },
            { label: 'Employees', value: (detailsFor.entries || []).map(en => `${en.empName} (${CURR_SYMBOLS[detailsFor.currency]}${Number(en.amount).toFixed(0)})`).join(', ') },
            { label: 'დანიშნულება', value: detailsFor.purpose },
            { label: 'Total', value: `${CURR_SYMBOLS[detailsFor.currency]}${Number(detailsFor.total).toFixed(2)}` },
            { label: 'Currency', value: detailsFor.currency },
          ]}
        />
      )}

      {showForm && (
        <SubTabModal title={editId ? 'Edit Bonus Batch' : 'Bonus'} onClose={() => { setShowForm(false); setEditId(null); setError(''); }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={LABEL}>Month</label>
                <input type="month" value={form.month} onChange={e => setForm(p => ({ ...p, month: e.target.value }))} style={{ ...INPUT, colorScheme: 'dark' }} required />
              </div>
              <div>
                <label style={LABEL}>Currency</label>
                <select value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} required style={INPUT}>
                  <option value="">— Select currency —</option>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>{t('orders.transferDate')}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={form.autoDate}
                  onChange={e => setForm(p => ({ ...p, autoDate: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                ASAP · {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </label>
              {!form.autoDate && (
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                  style={{ ...INPUT, marginTop: 8 }}
                />
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>დანიშნულება</label>
              <input
                type="text"
                value={form.purpose}
                onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))}
                placeholder="მაგ. Q3 პერფორმანს ბონუსი"
                style={INPUT}
              />
            </div>

            <div style={{ marginBottom: 14, padding: 12, borderRadius: 9, border: '1px dashed var(--border-2)', background: 'var(--surface-2)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Bulk upload</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={downloadBulkTemplate} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, border: '1.5px solid var(--border-2)', background: 'var(--surface)', color: '#479c73', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download Template
                </button>
                <input ref={bulkFileRef} type="file" accept=".xlsx,.xls" onChange={handleBulkUpload} style={{ display: 'none' }} id="bonus-bulk-upload" disabled={saving} />
                <button type="button" onClick={() => bulkFileRef.current?.click()} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, border: '1.5px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  {saving ? 'Uploading…' : 'Upload Filled File'}
                </button>
              </div>
              {bulkError && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8, marginBottom: 0 }}>{bulkError}</p>}
              {bulkSummary && (
                <p style={{ fontSize: 12, marginTop: 8, marginBottom: 0, color: '#479c73' }}>
                  ✓ Created {bulkSummary.createdCount} bonus{bulkSummary.createdCount !== 1 ? 'es' : ''}.
                  {bulkSummary.unmatched.length > 0 && (
                    <span style={{ color: '#f59e0b' }}> · {bulkSummary.unmatched.length} row{bulkSummary.unmatched.length !== 1 ? 's' : ''} not matched: {bulkSummary.unmatched.join(', ')}</span>
                  )}
                </p>
              )}
            </div>

            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ ...LABEL, marginBottom: 0 }}>Employees</label>
              {selectedIds.length > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {selectedIds.length} selected · <strong style={{ color: '#479c73' }}>{CURR_SYMBOLS[form.currency]}{selectedTotal.toFixed(2)}</strong>
                </span>
              )}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employee…"
              style={{ ...INPUT, marginBottom: 8 }}
            />
            <div style={{ border: '1px solid var(--border-2)', borderRadius: 9, maxHeight: 280, overflowY: 'auto' }}>
              {filteredEmployees.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-4)' }}>No matches</div>
              ) : filteredEmployees.map((emp, i) => {
                const checked = Object.prototype.hasOwnProperty.call(form.selections, emp.id);
                return (
                  <div key={emp.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderBottom: i < filteredEmployees.length - 1 ? '1px solid var(--border-2)' : 'none',
                    background: checked ? 'rgba(71,156,115,0.06)' : 'transparent',
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleEmp(emp.id)} style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />
                    <span
                      onClick={() => toggleEmp(emp.id)}
                      style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {emp.first_name} {emp.last_name}
                    </span>
                    {checked && (
                      <div style={{ position: 'relative', width: 130, flexShrink: 0 }}>
                        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 12 }}>{CURR_SYMBOLS[form.currency]}</span>
                        <input
                          type="number" min={0} step="0.01"
                          value={form.selections[emp.id]}
                          onChange={e => setAmount(emp.id, e.target.value)}
                          placeholder="0.00"
                          onClick={e => e.stopPropagation()}
                          style={{ ...INPUT, padding: '6px 8px 6px 22px', fontSize: 12, width: '100%' }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8, marginBottom: 0 }}>{error}</p>}
            <SubTabActions onCancel={() => { setShowForm(false); setEditId(null); setError(''); }} saving={saving} disabled={!canSave} />
          </form>
        </SubTabModal>
      )}
    </div>
  );
}

// ── Handover Tab ──────────────────────────────────────────────────────────────
function HandoverTab({ employees, registerAdd }) {
  const { t } = useLanguage();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const EMPTY = { fromEmployeeId: '', toEmployeeId: '', handoverDate: '', items: '', notes: '', immediateEffect: true };
  const [form, setForm] = useState(EMPTY);
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/handovers');
      setOrders((res.data.records || []).map(r => ({
        id: r.id,
        createdAt: r.created_at,
        fromEmployeeId: r.from_employee_id,
        toEmployeeId: r.to_employee_id,
        handoverDate: r.handover_date,
        items: r.items || '',
        notes: r.notes || '',
      })));
    } catch { /* non-critical */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const [detailsFor, setDetailsFor] = useState(null);
  const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); setError(''); };
  useEffect(() => { if (registerAdd) registerAdd.current = openAdd; });
  const openEdit = (o) => {
    setEditing(o.id);
    setForm({ fromEmployeeId: o.fromEmployeeId, toEmployeeId: o.toEmployeeId, handoverDate: o.handoverDate, items: o.items || '', notes: o.notes || '', immediateEffect: o.immediateEffect !== false });
    setShowForm(true);
    setError('');
  };
  const openCopy = (o) => {
    setEditing(null);
    setForm({ fromEmployeeId: o.fromEmployeeId, toEmployeeId: o.toEmployeeId, handoverDate: o.handoverDate, items: o.items || '', notes: o.notes || '', immediateEffect: o.immediateEffect !== false });
    setShowForm(true);
    setError('');
  };
  const close = () => { setShowForm(false); setEditing(null); };

  const getName = (id) => { const e = employees.find(x => x.id === id); return e ? `${e.first_name} ${e.last_name}` : '—'; };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        from_employee_id: form.fromEmployeeId,
        to_employee_id: form.toEmployeeId,
        handover_date: form.handoverDate,
        items: form.items,
        notes: form.notes,
      };
      if (editing) await api.put(`/handovers/${editing}`, payload);
      else await api.post('/handovers', payload);
      close();
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'შენახვა ვერ მოხერხდა.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (o) => {
    if (!window.confirm('წავშალოთ ეს დელეგირების ბრძანება?')) return;
    try { await api.delete(`/handovers/${o.id}`); load(); }
    catch { setError('წაშლა ვერ მოხერხდა.'); }
  };

  const canSave = form.fromEmployeeId && form.toEmployeeId && form.fromEmployeeId !== form.toEmployeeId && form.handoverDate;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        {orders.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(orders, [
          { header: 'Date', get: o => o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '' },
          { header: 'From', get: o => getName(o.fromEmployeeId) },
          { header: 'To', get: o => getName(o.toEmployeeId) },
          { header: 'Handover Date', get: o => o.handoverDate || '' },
          { header: 'Items', get: o => o.items || '' },
          { header: 'Notes', get: o => o.notes || '' },
        ], 'Handover', 'Handover-Orders')} />}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>Loading…</div>
        ) : orders.length === 0 ? <EmptyState label={t('orders.handover')} onAdd={openAdd} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {[t('orders.date'), t('orders.fromEmployee'), t('orders.toEmployee'), t('orders.handoverDate'), t('orders.handoverItems'), t('orders.notes'), ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-2)', cursor: 'pointer' }} onClick={openRowMenu} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{o.fromName || getName(o.fromEmployeeId)}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: '#3b82f6', whiteSpace: 'nowrap' }}>{o.toName || getName(o.toEmployeeId)}</td>
                  <td style={{ padding: '11px 14px', color: '#f59e0b', fontWeight: 600, whiteSpace: 'nowrap' }}>{o.handoverDate ? new Date(o.handoverDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.items || '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes || '—'}</td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <RowActionsMenu
                        t={t}
                        onCopy={() => openCopy(o)}
                        onEdit={() => openEdit(o)}
                        onDetails={() => setDetailsFor(o)}
                        onDelete={() => handleRemove(o)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {detailsFor && (
        <DetailsModal
          t={t}
          title={t('orders.handover')}
          onClose={() => setDetailsFor(null)}
          fields={[
            { label: t('orders.date'), value: new Date(detailsFor.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { label: t('orders.fromEmployee'), value: detailsFor.fromName || getName(detailsFor.fromEmployeeId) },
            { label: t('orders.toEmployee'), value: detailsFor.toName || getName(detailsFor.toEmployeeId) },
            { label: t('orders.handoverDate'), value: detailsFor.handoverDate ? new Date(detailsFor.handoverDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null },
            { label: t('orders.handoverItems'), value: detailsFor.items },
            { label: t('orders.notes'), value: detailsFor.notes },
          ]}
        />
      )}
      {showForm && (
        <SubTabModal title={editing ? t('orders.editHandoverOrder') : t('orders.newHandoverOrder')} onClose={close}>
          <form onSubmit={handleSubmit}>
            {error && <div className="msg-error" style={{ marginBottom: 14 }}>{error}</div>}
            <div style={{ display: 'grid', gap: 14 }}>
              <div><label style={LABEL}>{t('orders.fromEmployee')} *</label>
                <EmployeeSearchSelect employees={employees} value={form.fromEmployeeId} required placeholder={t('orders.selectEmployee')} onChange={f('fromEmployeeId')} />
              </div>
              <div><label style={LABEL}>{t('orders.toEmployee')} *</label>
                <EmployeeSearchSelect employees={employees} value={form.toEmployeeId} excludeId={form.fromEmployeeId} required placeholder={t('orders.selectEmployee')} onChange={f('toEmployeeId')} />
              </div>
              <ImmediateEffectToggle value={form.immediateEffect} onToggle={v => setForm(p => ({ ...p, immediateEffect: v, handoverDate: v ? p.handoverDate : endOfMonth(currentMonthStr()) }))} />
              <div><label style={LABEL}>{t('orders.handoverDate')} *</label><input type="date" value={form.handoverDate} onChange={f('handoverDate')} required style={{ ...INPUT, width: '100%' }} /></div>
              <div><label style={LABEL}>{t('orders.handoverItems')}</label><textarea value={form.items} onChange={f('items')} rows={3} placeholder="e.g. Laptop, project documentation, client contacts…" style={{ ...INPUT, resize: 'vertical', fontFamily: 'inherit' }} /></div>
              <div><label style={LABEL}>{t('orders.notes')}</label><input value={form.notes} onChange={f('notes')} style={{ ...INPUT, width: '100%' }} /></div>
            </div>
            <SubTabActions onCancel={close} saving={saving} disabled={!canSave} />
          </form>
        </SubTabModal>
      )}
    </div>
  );
}

// ── Shared icon/button styles ─────────────────────────────────────────────────
const actionBtn = { width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-3)', fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s' };
function EditIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
}
function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}
function DetailsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  );
}
function MenuDotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
    </svg>
  );
}

const ddItem = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-2)', fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.1s' };

// Shared per-row "⋯" menu: Copy (duplicate as a new unsaved draft) / Edit /
// Details (read-only field dump) / Delete. Any handler left out (undefined)
// simply doesn't render that item, so tabs without e.g. a live-row delete
// guard can omit it.
function RowActionsMenu({ onCopy, onEdit, onDetails, onDelete, t }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const L = (key, fallback) => (t ? t(key) : fallback);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPos(null); } };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setPos(null); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const act = (fn) => { setOpen(false); setPos(null); fn(); };

  return (
    <>
      <button
        onClick={e => {
          e.stopPropagation();
          if (open) { setOpen(false); setPos(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
          setOpen(true);
        }}
        style={actionBtn}
        title={L('orders.options', 'Options')}
        data-row-menu-trigger="true"
      >
        <MenuDotsIcon />
      </button>
      {open && pos && createPortal(
        <div ref={ref} style={{ position: 'fixed', top: pos.top, right: pos.right, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 9999, minWidth: 160, overflow: 'hidden' }}>
          {onCopy && (
            <button onClick={() => act(onCopy)} style={ddItem} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <CopyIcon /> {L('orders.copy', 'Copy')}
            </button>
          )}
          {onEdit && (
            <button onClick={() => act(onEdit)} style={ddItem} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <EditIcon /> {L('orders.edit', 'Edit')}
            </button>
          )}
          {onDetails && (
            <button onClick={() => act(onDetails)} style={ddItem} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <DetailsIcon /> {L('orders.details', 'Details')}
            </button>
          )}
          {onDelete && (
            <button onClick={() => act(onDelete)} style={{ ...ddItem, color: '#f87171' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <DeleteIcon /> {L('orders.delete', 'Delete')}
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// Lets a whole <tr> open its RowActionsMenu, not just the small "⋯" button —
// finds that row's own trigger button and clicks it, unless the click
// already originated from the button itself (which handles its own toggle).
const openRowMenu = (e) => {
  // Any other interactive element in the row (e.g. a PDF-download button)
  // handles its own click — only bare row space should open the menu.
  if (e.target.closest('button, a, input, select, textarea')) return;
  e.currentTarget.querySelector('[data-row-menu-trigger]')?.click();
};

// Generic read-only "Details" modal — pass an array of { label, value } pairs.
function DetailsModal({ title, fields, onClose, t }) {
  const shown = fields.filter(f => f && f.value !== undefined && f.value !== null && f.value !== '');
  return (
    <SubTabModal title={title || (t ? t('orders.details') : 'Details')} onClose={onClose} maxWidth={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map((f, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, paddingBottom: 8, borderBottom: i < shown.length - 1 ? '1px solid var(--border-2)' : 'none' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{f.label}</span>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>{f.value}</span>
          </div>
        ))}
      </div>
    </SubTabModal>
  );
}

export default function Orders() {
  const { t } = useLanguage();
  const ORDER_SUBTABS = ORDER_SUBTAB_KEYS.map(s => ({ ...s, label: t(s.labelKey) }));
  const [subTab, setSubTab] = useState('hiring');
  const [loadingSubTab, setLoadingSubTab] = useState(null);
  const [month, setMonth] = useState(currentMonth);
  const [employees, setEmployees] = useState([]);
  const [unitTypes, setUnitTypes] = useState([]);
  const [overtimeRates, setOvertimeRates] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [gelRate, setGelRate] = useState(null);
  const [eurRate, setEurRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const orderCounterRef = useRef(1);

  // Adjust table columns: label/alignment + how each column's value is read for
  // display+filtering (getValue) vs. sorting (getSortValue) — see useExcelTable.
  const ADJUST_COLUMNS = [
    {
      key: 'employee', label: t('orders.employee'), right: false,
      getValue: u => `${u.employee?.first_name || ''} ${u.employee?.last_name || ''}`.trim() || '—',
      getSortValue: u => `${u.employee?.first_name || ''} ${u.employee?.last_name || ''}`.toLowerCase(),
    },
    {
      key: 'type', label: t('orders.type'), right: false,
      getValue: u => u.type || '—',
      getSortValue: u => (u.type || '').toLowerCase(),
    },
    {
      key: 'direction', label: t('orders.direction'), right: false,
      getValue: u => (u.direction === 'addition' ? t('orders.addition') : t('orders.deduction')),
      getSortValue: u => (u.direction || ''),
    },
    {
      key: 'amount', label: t('orders.amount'), right: true,
      getValue: u => `${u.direction === 'addition' ? '+' : '−'}${fmt(u.amount)}`,
      getSortValue: u => parseFloat(u.amount) || 0,
    },
    {
      key: 'date', label: t('orders.date'), right: true,
      getValue: u => u.date ? new Date(u.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      getSortValue: u => u.date || '',
    },
    {
      key: 'created', label: t('orders.created'), right: true,
      getValue: u => u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      getSortValue: u => u.created_at || '',
    },
    {
      key: 'modified', label: t('orders.modified'), right: true,
      getValue: u => (u.updated_at && u.updated_at !== u.created_at) ? new Date(u.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      getSortValue: u => u.updated_at || '',
    },
  ];

  const renderAdjustCell = (key, u) => {
    switch (key) {
      case 'employee':
        return (
          <td style={{ padding: '12px 16px' }}>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>
              {u.employee?.first_name} {u.employee?.last_name}
            </div>
            {u.employee?.position && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{u.employee.position}</div>
            )}
            {u.include_in_salary === false && (
              <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                {t('orders.notInSalary')}
              </div>
            )}
          </td>
        );
      case 'type':
        return (
          <td style={{ padding: '12px 16px' }}>
            <span title={u.note || undefined} style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: u.direction === 'addition' ? 'rgba(71,156,115,0.12)' : 'rgba(220,38,38,0.1)',
              color: u.direction === 'addition' ? '#479c73' : '#f87171',
              border: `1px solid ${u.direction === 'addition' ? 'rgba(71,156,115,0.25)' : 'rgba(220,38,38,0.2)'}`,
            }}>
              {u.type}
            </span>
            {u.note && (
              <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 3, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.note}
              </div>
            )}
          </td>
        );
      case 'direction':
        return (
          <td style={{ padding: '12px 16px', color: u.direction === 'addition' ? '#479c73' : '#f87171', fontSize: 12, fontWeight: 500 }}>
            {u.direction === 'addition' ? t('orders.addition') : t('orders.deduction')}
          </td>
        );
      case 'amount':
        return (
          <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontSize: 14, color: u.direction === 'addition' ? '#479c73' : '#f87171' }}>
            {u.direction === 'addition' ? '+' : '−'}{fmt(u.amount)}
          </td>
        );
      case 'date':
        return (
          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-3)', fontSize: 12 }}>
            {u.date ? new Date(u.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
          </td>
        );
      case 'created':
        return (
          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-4)', fontSize: 11 }}>
            {u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
          </td>
        );
      case 'modified':
        return (
          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-4)', fontSize: 11 }}>
            {u.updated_at && u.updated_at !== u.created_at ? new Date(u.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
          </td>
        );
      default:
        return <td style={{ padding: '12px 16px' }} />;
    }
  };

  const EMPTY_FORM = { employeeId: '', type: 'OT', amount: '', otRate: '110', otHours: '', currency: '', includeInSalary: true, date: '', autoDate: true };
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingUnit, setEditingUnit] = useState(null);
  const [detailsForUnit, setDetailsForUnit] = useState(null);

  const perms = useOrdersPermissions();

  // Shared "+ New Order" trigger for every sub-tab -- each tab registers its
  // own openAdd function here on mount, so one button in the shared toolbar
  // can open whichever tab is currently active without each tab needing its
  // own separately-positioned button.
  const addTriggerRef = useRef(null);
  const SUBTAB_CREATE_PERM = {
    hiring: 'create_hiring', firing: 'create_firing', promotion: 'create_promotion',
    adjusting: 'create_adjusting', 'business-trip': 'create_business_trip',
  };
  const canCreateCurrentTab = (() => {
    const permKey = SUBTAB_CREATE_PERM[subTab];
    return permKey ? perms[permKey] === 'Yes' : true; // advance-payment/handover/bonus have no gate today
  })();

  // ── Data loading ────────────────────────────────────────────
  const loadStatic = useCallback(async () => {
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
        employeeId: emps[0]?.id || '',
        otRate: rates[0] ? String(rates[0].rate) : '',
      }));
    } catch {}
  }, []);

  const loadSalaries = useCallback(async (m) => {
    setLoading(true);
    try {
      const res = await api.get('/salaries', { params: { month: m } });
      setSalaries(res.data.salaries || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  const loadRates = useCallback(async () => {
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const data = await res.json();
      if (data.rates?.GEL) setGelRate(data.rates.GEL);
      if (data.rates?.EUR) setEurRate(data.rates.EUR);
    } catch {}
  }, []);

  useEffect(() => { loadStatic(); loadRates(); }, [loadStatic, loadRates]);
  useEffect(() => { loadSalaries(month); }, [month, loadSalaries]);

  // ── Demo seed (giorgi@powerbi.ge only, runs once) ────────────
  useEffect(() => {
    if (user?.email !== 'giorgi@powerbi.ge') return;
    if (localStorage.getItem('hr_demo_seeded')) return;
    if (employees.length === 0) return;

    const get = (i) => employees[i] || employees[0];
    const ts = Date.now();
    const mkId = (i) => ts - i * 100001;
    const mkDate = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]; };
    const mkCAt = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

    // Hiring
    const hiringData = [
      { firstName: 'Ana', lastName: 'Beridze', personalId: '01234567891', position: 'Accountant', department: 'Finance', startDate: mkDate(10), salary: '2500', salaryCurrency: 'GEL', pitRate: '20', pension: false, immediateEffect: true },
      { firstName: 'Giorgi', lastName: 'Kvaratskhelia', personalId: '01234567892', position: 'Developer', department: 'IT', startDate: mkDate(20), salary: '3500', salaryCurrency: 'GEL', pitRate: '20', pension: true, immediateEffect: true },
      { firstName: 'Nino', lastName: 'Tsiklauri', personalId: '01234567893', position: 'HR Manager', department: 'HR', startDate: mkDate(30), salary: '2800', salaryCurrency: 'GEL', pitRate: '20', pension: true, immediateEffect: true },
      { firstName: 'Levan', lastName: 'Sharabidze', personalId: '01234567894', position: 'Sales Manager', department: 'Sales', startDate: mkDate(40), salary: '3200', salaryCurrency: 'GEL', pitRate: '20', pension: false, immediateEffect: true },
      { firstName: 'Tamar', lastName: 'Chikvanaia', personalId: '01234567895', position: 'Marketing Specialist', department: 'Marketing', startDate: mkDate(50), salary: '2200', salaryCurrency: 'GEL', pitRate: '20', pension: true, immediateEffect: true },
    ].map((d, i) => ({ id: mkId(i), createdAt: mkCAt(i * 5), ...d }));
    localStorage.setItem('hr_hiring_orders', JSON.stringify(hiringData));

    // Firing
    const firingData = [0,1,2,3,4].map((i) => {
      const emp = get(i);
      return { id: mkId(i + 10), createdAt: mkCAt(i * 4), employeeId: emp.id, empName: `${emp.first_name} ${emp.last_name}`, position: emp.position || 'Employee', terminationDate: mkDate(i * 5 + 2), reason: ['Resignation', 'End of contract', 'Mutual agreement', 'Restructuring', 'Performance'][i], notes: '', immediateEffect: true };
    });
    localStorage.setItem('hr_firing_orders', JSON.stringify(firingData));

    // Promotion
    const newPositions = ['Senior Developer', 'Team Lead', 'Project Manager', 'Senior Accountant', 'Chief Marketing Officer'];
    const newSalaries = ['4500', '5000', '6000', '3800', '4200'];
    const promotionData = [0,1,2,3,4].map((i) => {
      const emp = get(i);
      return { id: mkId(i + 20), createdAt: mkCAt(i * 3), employeeId: emp.id, empName: `${emp.first_name} ${emp.last_name}`, oldPosition: emp.position || 'Junior', newPosition: newPositions[i], oldSalary: emp.salary ? String(emp.salary) : '2000', newSalary: newSalaries[i], effectiveDate: mkDate(i * 7), notes: 'Performance-based promotion', immediateEffect: true };
    });
    localStorage.setItem('hr_promotion_orders', JSON.stringify(promotionData));

    // Business Trip
    const trips = [
      { countryCode: 'DE', countryName: 'Germany', cityName: 'Berlin', perDiem: '95' },
      { countryCode: 'FR', countryName: 'France', cityName: 'Paris', perDiem: '120' },
      { countryCode: 'TR', countryName: 'Turkey', cityName: 'Istanbul', perDiem: '65' },
      { countryCode: 'PL', countryName: 'Poland', cityName: 'Warsaw', perDiem: '70' },
      { countryCode: 'AE', countryName: 'UAE', cityName: 'Dubai', perDiem: '130' },
    ];
    const tripData = [0,1,2,3,4].map((i) => {
      const emp = get(i); const c = trips[i];
      const fromDate = mkDate(40 - i * 5); const toDate = mkDate(35 - i * 5);
      return { id: mkId(i + 30), createdAt: mkCAt(i * 6), employeeId: emp.id, empName: `${emp.first_name} ${emp.last_name}`, fromDate, toDate, days: 5, countryCode: c.countryCode, countryName: c.countryName, cityName: c.cityName, perDiem: c.perDiem, amount: String(parseFloat(c.perDiem) * 5), immediateEffect: true };
    });
    localStorage.setItem('hr_business_trip_orders', JSON.stringify(tripData));

    // Advance Payment
    const advCurrencies = ['GEL', 'USD', 'GEL', 'USD', 'GEL'];
    const advTotals = [3000, 2000, 4000, 1500, 2500];
    const [cy, cm] = currentMonth.split('-').map(Number);
    const nextM = new Date(cy, cm, 1); const nextMonthStr = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}`;
    const advanceData = [0,1,2,3,4].map((i) => {
      const emp = get(i); const total = advTotals[i];
      return { id: mkId(i + 40), createdAt: mkCAt(i * 2), employeeId: emp.id, empName: `${emp.first_name} ${emp.last_name}`, currency: advCurrencies[i], mode: 'automatic', total, schedule: [{ month: currentMonth, amount: total / 2 }, { month: nextMonthStr, amount: total / 2 }], immediateEffect: true };
    });
    localStorage.setItem('hr_advance_payment_orders', JSON.stringify(advanceData));

    // Adjusting — real API calls
    const adjTypes = ['OT', 'OT', 'OT', 'OT', 'OT'];
    const adjAmounts = [250, 180, 320, 150, 210];
    [0,1,2,3,4].forEach((i) => {
      const emp = get(i);
      api.post(`/employees/${emp.id}/units`, { type: adjTypes[i], amount: adjAmounts[i], date: mkDate(i * 3), currency: 'USD', include_in_salary: true }).catch(() => {});
    });

    localStorage.setItem('hr_demo_seeded', 'true');
  }, [user?.email, employees]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────
  const monthLastDay = (() => {
    const [y, m] = month.split('-');
    const last = new Date(Number(y), Number(m), 0).getDate();
    return `${month}-${String(last).padStart(2, '0')}`;
  })();

  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  })();

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

  const getWorkingDays = (empId) => salaries.find(s => s.employee?.id === empId)?.total_days || 0;
  const getEmpSalary = (empId) => parseFloat(salaries.find(s => s.employee?.id === empId)?.employee?.salary || 0);

  const calcOtAmount = (empId, rate, hours) => {
    const wdays = getWorkingDays(empId) || 22;
    const salary = getEmpSalary(empId);
    if (!salary || !hours || !rate) return '';
    const hr = salary / (wdays * 8);
    return (hr * (parseFloat(rate) / 100) * parseFloat(hours)).toFixed(2);
  };

  const isOT = form.type === 'OT' || form.type === 'Overtime';

  const allUnits = salaries.flatMap(s =>
    (s.deductions || []).map(u => ({
      ...u, employee: s.employee, direction: getDirection(u.type),
    }))
  );

  const filteredUnits = allUnits;

  const adjustTable = useExcelTable({ storageKey: 'orders_adjust', columns: ADJUST_COLUMNS, rows: filteredUnits });
  const sortedUnits = adjustTable.sortedRows;

  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // ── Submit ───────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.employeeId || !form.amount) return;
    setSaving(true);
    setError('');
    try {
      const amountUSD = toUSD(form.amount, form.currency);
      await api.post(`/employees/${form.employeeId}/units`, {
        type: form.type,
        amount: amountUSD,
        date: form.autoDate ? monthLastDay : (form.date || monthLastDay),
        currency: 'USD',
        include_in_salary: form.includeInSalary,
        // Original entered figure, so the auto-queued transfer converts
        // straight from it instead of re-deriving GEL from the already
        // USD-converted amount (a second exchange-rate lookup drifts from
        // what was actually typed in).
        original_amount: form.amount,
        original_currency: form.currency,
      });

      // A transfer for positive (addition-direction) adjustments is queued
      // automatically server-side (see createEmployeeUnit), regardless of
      // "Include in Salary" -- no client-side call needed here.

      setShowForm(false);
      setForm({ ...EMPTY_FORM, date: monthLastDay, otRate: overtimeRates[0] ? String(overtimeRates[0].rate) : '110' });
      loadSalaries(month);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add order.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (u) => {
    setEditingUnit({ id: u.id, employeeId: u.employee?.id });
    setForm({
      employeeId: u.employee?.id || '',
      type: u.type,
      amount: String(u.amount),
      otRate: '',
      otHours: '',
      currency: 'USD',
      includeInSalary: u.include_in_salary !== false,
      date: u.date ? u.date.slice(0, 10) : monthLastDay,
      autoDate: false,
    });
    setError('');
    setShowForm(true);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editingUnit || !form.amount) return;
    setSaving(true);
    setError('');
    try {
      const amountUSD = toUSD(form.amount, form.currency);
      if (form.employeeId !== editingUnit.employeeId) {
        // Employee changed — delete old unit, create new one under correct employee
        await api.delete(`/employees/${editingUnit.employeeId}/units/${editingUnit.id}`);
        await api.post(`/employees/${form.employeeId}/units`, {
          type: form.type,
          amount: amountUSD,
          date: form.autoDate ? monthLastDay : (form.date || monthLastDay),
          currency: 'USD',
          include_in_salary: form.includeInSalary,
          skip_transfer: true, // editing -- the original transfer may already be approved/paid
        });
      } else {
        await api.put(`/employees/${form.employeeId}/units/${editingUnit.id}`, {
          type: form.type,
          amount: amountUSD,
          currency: 'USD',
          include_in_salary: form.includeInSalary,
        });
      }
      setShowForm(false);
      setForm({ ...EMPTY_FORM, date: monthLastDay, otRate: overtimeRates[0] ? String(overtimeRates[0].rate) : '110' });
      setEditingUnit(null);
      loadSalaries(month);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update order.');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = (u) => {
    setEditingUnit(null);
    setForm({
      employeeId: u.employee?.id || '',
      type: u.type,
      amount: String(u.amount),
      otRate: '',
      otHours: '',
      currency: 'USD',
      includeInSalary: u.include_in_salary !== false,
      date: monthLastDay,
      autoDate: true,
    });
    setError('');
    setShowForm(true);
  };

  const handleDelete = async (employeeId, unitId) => {
    if (!window.confirm(t('orders.removeConfirm'))) return;
    try {
      await api.delete(`/employees/${employeeId}/units/${unitId}`);
      loadSalaries(month);
    } catch {
      setError('Failed to delete order.');
    }
  };

  const handleDownloadPdf = (u, i) => {
    generateOrderPDF({
      employee: u.employee || {},
      type: u.type,
      direction: u.direction,
      amount: parseFloat(u.amount),
      date: u.date,
      month,
      companyName: user?.user_metadata?.company_name || user?.email || 'Company',
      orderNumber: i + 1,
    });
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400 }}>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{t('orders.title')}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>
          {t('orders.subtitle')} · {monthLabel}
        </p>
      </div>

      {/* Subtabs + the one shared "+ New Order" button -- always on one row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: subTab === 'adjusting' ? 14 : 24 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
          {ORDER_SUBTABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                if (tab.key === subTab) return;
                setLoadingSubTab(tab.key);
                setTimeout(() => setLoadingSubTab(null), 220);
                setSubTab(tab.key);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '7px 18px', border: 'none', borderRadius: 7,
                fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                background: subTab === tab.key ? 'var(--surface)' : 'transparent',
                color: subTab === tab.key ? 'var(--text)' : 'var(--text-3)',
                boxShadow: subTab === tab.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
              {loadingSubTab === tab.key && <span className="fp-spinner fp-spinner-sm" />}
            </button>
          ))}
        </div>

        <div style={{ flexShrink: 0 }}>
          {/* One "+ New Order" button for every sub-tab -- opens whichever
              tab's own add form is currently active (see addTriggerRef). */}
          {canCreateCurrentTab && <button
            onClick={() => {
              if (subTab === 'adjusting') {
                setForm(f => ({ ...EMPTY_FORM, date: monthLastDay, otRate: overtimeRates[0] ? String(overtimeRates[0].rate) : '110' }));
                setShowForm(true);
                setError('');
              } else {
                addTriggerRef.current?.();
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 20px', borderRadius: 9, border: 'none',
              background: '#479c73', color: '#fff',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(71,156,115,0.3)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {t('orders.addNew')}
          </button>}
        </div>
      </div>

      {/* Adjusting-only: month picker, columns, export -- own row so the
          tabs + "+ New Order" row above always stays on a single line
          regardless of viewport width. */}
      {subTab === 'adjusting' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={prevMonth} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...INPUT, width: 'auto', padding: '6px 12px', colorScheme: 'dark' }} />
            <button onClick={nextMonth} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          </div>
          <ColumnVisibilityMenu table={adjustTable} t={t} />
          {sortedUnits.length > 0 && <ExportExcelButton onClick={() => exportOrdersToExcel(sortedUnits, [
            { header: 'Date', get: u => u.date ? new Date(u.date).toLocaleDateString('en-GB') : '' },
            { header: 'Employee', get: u => `${u.employee?.first_name || ''} ${u.employee?.last_name || ''}`.trim() },
            { header: 'Type', get: u => u.type || '' },
            { header: 'Direction', get: u => u.direction === 'addition' ? t('orders.addition') : t('orders.deduction') },
            { header: 'Amount', get: u => u.amount || '' },
            { header: 'Currency', get: u => u.currency || '' },
            { header: 'Include in Salary', get: u => u.include_in_salary !== false ? 'Yes' : 'No' },
            { header: 'Note', get: u => u.note || '' },
          ], 'Adjusting', 'Adjusting-Orders')} />}
        </div>
      )}

      {/* Non-adjusting tabs */}
      <div key={subTab} className="fp-subtab-enter">
        {subTab === 'promotion'        && <PromotionTab employees={employees} registerAdd={addTriggerRef} />}
        {subTab === 'hiring'           && <HiringTab registerAdd={addTriggerRef} />}
        {subTab === 'firing'           && <FiringTab employees={employees} registerAdd={addTriggerRef} />}
        {subTab === 'business-trip'    && <BusinessTripTab employees={employees} registerAdd={addTriggerRef} />}
        {subTab === 'advance-payment'  && <AdvancePaymentTab employees={employees} gelRate={gelRate} eurRate={eurRate} registerAdd={addTriggerRef} />}
        {subTab === 'handover'         && <HandoverTab employees={employees} registerAdd={addTriggerRef} />}
        {subTab === 'bonus'            && <BonusTab employees={employees} gelRate={gelRate} eurRate={eurRate} registerAdd={addTriggerRef} />}
      </div>

      {subTab === 'adjusting' && <>
      {/* Orders list */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <TableSkeleton
            icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            }
            color="#3b82f6"
            label={t('orders.loading')}
            cols={[
              { width: '18%' }, { width: '14%' }, { width: '14%' }, { width: '14%' },
              { width: '20%' }, { width: '12%', align: 'right' },
            ]}
          />
        ) : filteredUnits.length > 0 && sortedUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-3)', fontSize: 13 }}>
            {t('orders.noFilterMatches')}
            <div>
              <button
                onClick={adjustTable.clearAllColumnFilters}
                style={{ marginTop: 10, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {t('orders.clear')}
              </button>
            </div>
          </div>
        ) : filteredUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 24px' }}>
            <div style={{ marginBottom: 16 }}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="6" width="28" height="36" rx="4" stroke="var(--text-3)" strokeWidth="2" opacity="0.5"/>
                <rect x="10" y="6" width="28" height="10" rx="4" fill="var(--text-3)" opacity="0.12"/>
                <line x1="17" y1="24" x2="31" y2="24" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" opacity="0.35"/>
                <line x1="17" y1="30" x2="27" y2="30" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" opacity="0.25"/>
                <line x1="17" y1="36" x2="24" y2="36" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" opacity="0.15"/>
                <circle cx="36" cy="36" r="9" fill="var(--surface)" stroke="var(--text-3)" strokeWidth="2" opacity="0.5"/>
                <line x1="36" y1="32" x2="36" y2="40" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
                <line x1="32" y1="36" x2="40" y2="36" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
              </svg>
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15, marginBottom: 6 }}>{t('orders.noOrders', { month: monthLabel })}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>{t('orders.noOrdersHint')}</div>
            <button
              onClick={() => { setForm(f => ({ ...EMPTY_FORM, date: monthLastDay, otRate: overtimeRates[0] ? String(overtimeRates[0].rate) : '110' })); setShowForm(true); setError(''); }}
              style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#479c73', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              + {t('orders.addNew')}
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <TableHeaderRow table={adjustTable} t={t} extraCols={[{ label: '', right: true }, { label: '', right: true }]} />
            </thead>
            <tbody>
              {adjustTable.pagedRows.map((u, i) => (
                <tr key={`${u.id}-${i}`} style={{ borderBottom: '1px solid var(--border-2)', transition: 'background 0.1s', opacity: u.include_in_salary === false ? 0.6 : 1, cursor: 'pointer' }}
                  onClick={openRowMenu}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {adjustTable.displayCols.map(key => (
                    <React.Fragment key={key}>{renderAdjustCell(key, u)}</React.Fragment>
                  ))}

                  {/* Actions */}
                  <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {/* PDF */}
                      <button
                        onClick={() => handleDownloadPdf(u, i)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#3b82f6'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-2)'; e.currentTarget.style.color = 'var(--text-3)'; }}
                        title="Download PDF"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="12" y1="18" x2="12" y2="12"/>
                          <polyline points="9 15 12 18 15 15"/>
                        </svg>
                        PDF
                      </button>
                    </div>
                  </td>

                  {/* Copy / Edit / Details / Delete */}
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <RowActionsMenu
                      t={t}
                      onCopy={() => handleDuplicate(u)}
                      onEdit={() => handleEdit(u)}
                      onDetails={() => setDetailsForUnit(u)}
                      onDelete={() => handleDelete(u.employee?.id, u.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sortedUnits.length > 0 && <PaginationBar table={adjustTable} t={t} />}
      </div>

      {detailsForUnit && (
        <DetailsModal
          t={t}
          title={t('orders.adjusting')}
          onClose={() => setDetailsForUnit(null)}
          fields={[
            { label: t('orders.employee'), value: detailsForUnit.employee ? `${detailsForUnit.employee.first_name} ${detailsForUnit.employee.last_name}` : null },
            { label: 'Position', value: detailsForUnit.employee?.position },
            { label: 'Type', value: detailsForUnit.type },
            { label: t('orders.amount'), value: `${detailsForUnit.direction === 'addition' ? '+' : '−'}${fmt(detailsForUnit.amount)}` },
            { label: t('orders.date'), value: detailsForUnit.date ? new Date(detailsForUnit.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null },
            { label: t('orders.includeInSalary'), value: detailsForUnit.include_in_salary === false ? '✗' : '✓' },
          ]}
        />
      )}

      {/* ── MODAL FORM OVERLAY ── */}
      {showForm && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); setEditingUnit(null); setForm({ ...EMPTY_FORM, date: monthLastDay, otRate: overtimeRates[0] ? String(overtimeRates[0].rate) : '110' }); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', border: '1px solid var(--border-2)', overflow: 'hidden' }}>

            {/* Modal header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{editingUnit ? t('orders.editOrder') : t('orders.newOrder')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{monthLabel}</div>
              </div>
              <button onClick={() => { setShowForm(false); setEditingUnit(null); setForm({ ...EMPTY_FORM, date: monthLastDay, otRate: overtimeRates[0] ? String(overtimeRates[0].rate) : '110' }); }} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            {/* Modal body */}
            <form onSubmit={editingUnit ? handleUpdate : handleAdd} style={{ padding: 24 }}>
              {error && (
                <div style={{ padding: '9px 14px', background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>

                {/* Employee */}
                <div>
                  <label style={LABEL}>{t('orders.employee')} *</label>
                  <EmployeeSearchSelect employees={employees} value={form.employeeId} required placeholder={t('orders.selectEmployee')} onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))} />
                </div>

                {/* Type */}
                <div>
                  <label style={LABEL}>{t('orders.orderType')}</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value, amount: '', otHours: '' }))} required style={INPUT}>
                    <option value="OT">OT — Overtime (+)</option>
                    {unitTypes.map(ut => (
                      <option key={ut.id} value={ut.name}>{ut.name} ({ut.direction === 'addition' ? '+' : '−'})</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, marginTop: 5, color: getDirection(form.type) === 'addition' ? '#479c73' : '#f87171' }}>
                    {getDirection(form.type) === 'addition' ? t('orders.addedToNet') : t('orders.deductedFromNet')}
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
                      <select value={form.otRate} onChange={e => {
                        const rate = e.target.value;
                        setForm(p => ({ ...p, otRate: rate, amount: calcOtAmount(p.employeeId, rate, p.otHours) }));
                      }} style={INPUT}>
                        {overtimeRates.length > 0
                          ? overtimeRates.map(r => <option key={r.id} value={String(r.rate)}>{r.label} ({r.rate}%)</option>)
                          : <><option value="110">110%</option><option value="200">200%</option></>
                        }
                      </select>
                    </div>
                    <div>
                      <label style={LABEL}>{t('orders.otHours')}</label>
                      <input type="number" min="0" step="0.5" placeholder="e.g. 8" value={form.otHours}
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
                    {form.currency !== 'USD' && form.amount
                      ? <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>≈ ${toUSD(form.amount, form.currency)}</span>
                      : null}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" step="0.01" min="0" placeholder="e.g. 150.00" value={form.amount}
                      onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                      required style={{ ...INPUT, flex: 1 }}
                    />
                    <select value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} required style={{ ...INPUT, width: 110, flexShrink: 0 }}>
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
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    display: 'block',
                  }} />
                </button>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowForm(false)}
                  style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  {t('orders.cancel')}
                </button>
                <button type="submit" disabled={saving || !form.amount || !form.employeeId || !form.currency}
                  style={{
                    padding: '9px 24px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
                    background: saving || !form.amount || !form.employeeId ? 'var(--surface-2)' : 'var(--accent, #3b82f6)',
                    color: saving || !form.amount || !form.employeeId ? 'var(--text-3)' : '#fff',
                    cursor: saving || !form.amount || !form.employeeId ? 'not-allowed' : 'pointer',
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
                      {editingUnit ? t('orders.updateOrder') : t('orders.save')}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>}
    </div>
  );
}
