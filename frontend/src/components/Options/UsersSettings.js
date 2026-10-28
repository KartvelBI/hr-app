import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';

const RIGHTS = ['Super Admin', 'Admin', 'Member'];

const RIGHTS_STYLE = {
  'Super Admin': { background: '#fdf4ff', color: '#7e22ce', border: '1px solid #e9d5ff' },
  'Admin':       { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  'Member':      { background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb' },
};

const ROLES_INFO = [
  {
    role: 'Super Admin',
    style: RIGHTS_STYLE['Super Admin'],
    description: 'Full access to all features including settings, billing, and user management.',
    permissions: ['Manage users & roles', 'Access all modules', 'Edit settings', 'View billing', 'Delete records'],
  },
  {
    role: 'Admin',
    style: RIGHTS_STYLE['Admin'],
    description: 'Can manage most features but cannot access billing or user management.',
    permissions: ['Access all modules', 'Edit records', 'Export data', 'View reports'],
  },
  {
    role: 'Member',
    style: RIGHTS_STYLE['Member'],
    description: 'Standard access with read and limited write permissions.',
    permissions: ['View records', 'Add basic entries', 'Export own data'],
  },
];

const EMPTY = { name: '', email: '', phone: '', rights: 'Member' };

const PERMISSION_COLS = [
  { key: 'initiate_transfer',  label: 'Initiate Transfer' },
  { key: 'approve_transfer',   label: 'Approve Transfer' },
  { key: 'reject_transfer',    label: 'Reject Transfer' },
  { key: 'view_transactions',  label: 'View Transactions' },
  { key: 'cancel_transaction', label: 'Cancel Transaction' },
  { key: 'set_limits',         label: 'Set Limits' },
  { key: 'manage_users',       label: 'Manage Users' },
  { key: 'audit_reports',      label: 'Audit / Reports' },
  { key: 'transfer_limit',     label: 'Transfer Limit', isText: true },
];

const PERM_OPTIONS = ['Yes', 'No', 'Own only', 'Conditional', 'View only'];

const PERM_COLORS = {
  'Yes':         { background: '#d1fae5', color: '#479c73' },
  'No':          { background: '#fee2e2', color: '#991b1b' },
  'Own only':    { background: '#fef9c3', color: '#854d0e' },
  'Conditional': { background: '#fef9c3', color: '#854d0e' },
  'View only':   { background: '#fef9c3', color: '#854d0e' },
};

const DEFAULT_MATRIX = [
  { role: 'Client / End User',         description: 'Account holder making transfers from own account',            initiate_transfer: 'Yes', approve_transfer: 'No',          reject_transfer: 'No',  view_transactions: 'Own only',    cancel_transaction: 'Conditional', set_limits: 'No',          manage_users: 'No',          audit_reports: 'No',       transfer_limit: '10,000' },
  { role: 'Teller',                     description: 'Front-line staff handling daily customer transactions',       initiate_transfer: 'Yes', approve_transfer: 'No',          reject_transfer: 'No',  view_transactions: 'Yes',         cancel_transaction: 'Conditional', set_limits: 'No',          manage_users: 'No',          audit_reports: 'No',       transfer_limit: '25,000' },
  { role: 'Maker (Operations Officer)', description: 'Initiates payments and transfers in the system',             initiate_transfer: 'Yes', approve_transfer: 'No',          reject_transfer: 'No',  view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'No',          manage_users: 'No',          audit_reports: 'No',       transfer_limit: '100,000' },
  { role: 'Checker (Approver L1)',      description: 'Reviews and approves transactions submitted by Maker',       initiate_transfer: 'No',  approve_transfer: 'Yes',         reject_transfer: 'Yes', view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'No',          manage_users: 'No',          audit_reports: 'View only', transfer_limit: '500,000' },
  { role: 'Senior Approver (L2)',       description: 'Approves high-value transfers above L1 threshold',           initiate_transfer: 'No',  approve_transfer: 'Yes',         reject_transfer: 'Yes', view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'Conditional', manage_users: 'No',          audit_reports: 'View only', transfer_limit: '5,000,000' },
  { role: 'Branch Manager',            description: 'Oversees branch operations and exceptional approvals',        initiate_transfer: 'Yes', approve_transfer: 'Yes',         reject_transfer: 'Yes', view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'Yes',         manage_users: 'Conditional', audit_reports: 'Yes',      transfer_limit: '10,000,000' },
  { role: 'Compliance Officer',        description: 'Reviews transactions for AML/KYC and regulatory compliance',  initiate_transfer: 'No',  approve_transfer: 'Conditional', reject_transfer: 'Yes', view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'No',          manage_users: 'No',          audit_reports: 'Yes',      transfer_limit: 'N/A' },
  { role: 'Risk Officer',              description: 'Monitors risk exposure and can block suspicious activity',     initiate_transfer: 'No',  approve_transfer: 'No',          reject_transfer: 'Yes', view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'Yes',         manage_users: 'No',          audit_reports: 'Yes',      transfer_limit: 'N/A' },
  { role: 'Finance Controller',        description: 'Manages reconciliation, GL postings, internal transfers',      initiate_transfer: 'Yes', approve_transfer: 'Yes',         reject_transfer: 'No',  view_transactions: 'Yes',         cancel_transaction: 'Conditional', set_limits: 'Yes',         manage_users: 'No',          audit_reports: 'Yes',      transfer_limit: '2,000,000' },
  { role: 'Auditor',                   description: 'Read-only access for internal/external audits',               initiate_transfer: 'No',  approve_transfer: 'No',          reject_transfer: 'No',  view_transactions: 'Yes',         cancel_transaction: 'No',          set_limits: 'No',          manage_users: 'No',          audit_reports: 'Yes',      transfer_limit: 'N/A' },
  { role: 'System Administrator',      description: 'Manages user accounts, roles, and system configuration',      initiate_transfer: 'No',  approve_transfer: 'No',          reject_transfer: 'No',  view_transactions: 'Yes',         cancel_transaction: 'No',          set_limits: 'Yes',         manage_users: 'Yes',         audit_reports: 'View only', transfer_limit: 'N/A' },
  { role: 'Super Admin / CFO',         description: 'Highest authority — overrides and policy-level decisions',    initiate_transfer: 'Yes', approve_transfer: 'Yes',         reject_transfer: 'Yes', view_transactions: 'Yes',         cancel_transaction: 'Yes',         set_limits: 'Yes',         manage_users: 'Yes',         audit_reports: 'Yes',      transfer_limit: 'Unlimited' },
];

const NOTIF_EVENT_COLS = [
  { key: 'transfer_submitted', label: 'Transfer Submitted' },
  { key: 'transfer_approved',  label: 'Transfer Approved' },
  { key: 'transfer_rejected',  label: 'Transfer Rejected' },
  { key: 'transfer_partial',   label: 'Partial Approval' },
  { key: 'transfer_wait',      label: 'On Hold' },
];

const NOTIF_OPTIONS = ['Yes', 'No'];

const ORDER_PERMISSION_COLS = [
  { key: 'create_hiring',        label: 'Create Hiring' },
  { key: 'create_firing',        label: 'Create Firing' },
  { key: 'create_promotion',     label: 'Create Promotion' },
  { key: 'create_adjusting',     label: 'Create Adjusting' },
  { key: 'create_business_trip', label: 'Create Business Trip' },
  { key: 'view_orders',          label: 'View Orders' },
];

const DEFAULT_ORDERS_MATRIX = [
  { role: 'Super Admin',         description: 'Full access to all orders',   create_hiring: 'Yes', create_firing: 'Yes', create_promotion: 'Yes', create_adjusting: 'Yes', create_business_trip: 'Yes', view_orders: 'Yes' },
  { role: 'Admin',               description: 'Can manage most orders',      create_hiring: 'Yes', create_firing: 'Yes', create_promotion: 'Yes', create_adjusting: 'Yes', create_business_trip: 'Yes', view_orders: 'Yes' },
  { role: 'Member',              description: 'Standard access',             create_hiring: 'No',  create_firing: 'No',  create_promotion: 'No',  create_adjusting: 'No',  create_business_trip: 'Yes', view_orders: 'Own only' },
];

function UsersSettings() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pwdModal, setPwdModal] = useState(null);
  const [pwd, setPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const [matrixRows, setMatrixRows] = useState(null);
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [matrixError, setMatrixError] = useState('');

  const [ordersMatrixRows, setOrdersMatrixRows] = useState(null);
  const [ordersMatrixDirty, setOrdersMatrixDirty] = useState(false);

  const [notifMatrixRows, setNotifMatrixRows] = useState(null);
  const [notifMatrixDirty, setNotifMatrixDirty] = useState(false);
  const [notifMatrixSaving, setNotifMatrixSaving] = useState(false);
  const [notifMatrixError, setNotifMatrixError] = useState('');

  const [roleModal, setRoleModal] = useState(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState('');

  const currentRights = (() => {
    try { const s = localStorage.getItem('member_user'); return s ? JSON.parse(s).rights : 'Super Admin'; } catch { return 'Super Admin'; }
  })();
  const canEditMatrix = currentRights === 'Super Admin' || currentRights === 'Admin';

  useEffect(() => { load(); loadMatrix(); loadOrdersMatrix(); }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/users');
      setUsers(res.data.users || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => { setForm(EMPTY); setEditId(null); setError(''); setShowForm(true); };
  const openEdit = (u) => {
    setForm({ name: u.name, email: u.email || '', phone: u.phone || '', rights: u.rights || 'Member' });
    setEditId(u.id);
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      if (editId) await api.put(`/users/${editId}`, form);
      else await api.post('/users', form);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete user "${u.name}"?`)) return;
    setError('');
    try {
      await api.delete(`/users/${u.id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete.');
    }
  };

  const openPwd = (u) => { setPwdModal(u); setPwd(''); setPwdConfirm(''); setPwdError(''); setPwdSuccess(false); };

  const handleSetPassword = async () => {
    if (pwd.length < 6) { setPwdError('Password must be at least 6 characters.'); return; }
    if (pwd !== pwdConfirm) { setPwdError('Passwords do not match.'); return; }
    setPwdSaving(true); setPwdError('');
    try {
      await api.put(`/users/${pwdModal.id}/password`, { password: pwd });
      setPwdSuccess(true);
      setTimeout(() => setPwdModal(null), 1200);
    } catch (err) {
      setPwdError(err.response?.data?.error || 'Failed to set password.');
    } finally { setPwdSaving(false); }
  };

  const loadMatrix = async () => {
    setMatrixError('');
    try {
      const res = await api.get('/user-matrix');
      setMatrixRows(res.data.rows || []);
    } catch { setMatrixRows([]); }
  };

  const saveMatrix = async () => {
    setMatrixSaving(true); setMatrixError('');
    try {
      await api.put('/user-matrix', { rows: matrixRows });
      setMatrixDirty(false);
    } catch (err) {
      setMatrixError(err.response?.data?.error || 'Failed to save.');
    } finally { setMatrixSaving(false); }
  };

  const updateCell = (rowIdx, key, value) => {
    setMatrixRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: value } : r));
    setMatrixDirty(true);
  };

  const loadOrdersMatrix = () => {
    try {
      const local = localStorage.getItem('orders_matrix');
      setOrdersMatrixRows(local ? JSON.parse(local) : []);
    } catch {
      setOrdersMatrixRows([]);
    }
  };

  const saveOrdersMatrix = () => {
    localStorage.setItem('orders_matrix', JSON.stringify(ordersMatrixRows));
    setOrdersMatrixDirty(false);
    window.dispatchEvent(new Event('storage'));
  };

  const updateOrdersCell = (rowIdx, key, value) => {
    setOrdersMatrixRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: value } : r));
    setOrdersMatrixDirty(true);
  };

  const handleDeleteOrdersRole = (idx) => {
    if (!window.confirm(`Delete role "${ordersMatrixRows[idx].role}" from Orders Matrix?`)) return;
    setOrdersMatrixRows(prev => prev.filter((_, i) => i !== idx));
    setOrdersMatrixDirty(true);
  };

  const loadNotifMatrix = async () => {
    setNotifMatrixError('');
    try {
      const res = await api.get('/notification-matrix');
      setNotifMatrixRows(res.data.rows || []);
    } catch { setNotifMatrixRows([]); }
  };

  const saveNotifMatrix = async () => {
    setNotifMatrixSaving(true); setNotifMatrixError('');
    try {
      await api.put('/notification-matrix', { rows: notifMatrixRows });
      setNotifMatrixDirty(false);
    } catch (err) {
      setNotifMatrixError(err.response?.data?.error || 'Failed to save.');
    } finally { setNotifMatrixSaving(false); }
  };

  const updateNotifCell = (rowIdx, key, value) => {
    setNotifMatrixRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: value } : r));
    setNotifMatrixDirty(true);
  };

  const handleDeleteNotifRole = (idx) => {
    if (!window.confirm(`Delete role "${notifMatrixRows[idx].role}" from Notification Matrix?`)) return;
    setNotifMatrixRows(prev => prev.filter((_, i) => i !== idx));
    setNotifMatrixDirty(true);
  };

  const openRoleModal = (idx) => {
    const row = idx === null
      ? { role: '', description: '' }
      : { role: matrixRows[idx].role, description: matrixRows[idx].description || '' };
    setRoleModal({ idx, ...row });
    setRoleError('');
  };

  const handleSaveRole = async () => {
    if (!roleModal.role.trim()) { setRoleError('Role name is required.'); return; }
    setRoleSaving(true); setRoleError('');
    const emptyRow = { initiate_transfer: 'No', approve_transfer: 'No', reject_transfer: 'No', view_transactions: 'No', cancel_transaction: 'No', set_limits: 'No', manage_users: 'No', audit_reports: 'No', transfer_limit: 'N/A' };
    const newRows = roleModal.idx === null
      ? [...(matrixRows || []), { ...emptyRow, role: roleModal.role, description: roleModal.description }]
      : matrixRows.map((r, i) => i === roleModal.idx ? { ...r, role: roleModal.role, description: roleModal.description } : r);
    try {
      await api.put('/user-matrix', { rows: newRows });
      setMatrixRows(newRows);
      setMatrixDirty(false);
      setRoleModal(null);
    } catch (err) {
      setRoleError(err.response?.data?.error || 'Failed to save.');
    } finally { setRoleSaving(false); }
  };

  const handleDeleteRole = async (idx) => {
    if (!window.confirm(`Delete role "${matrixRows[idx].role}"?`)) return;
    const newRows = matrixRows.filter((_, i) => i !== idx);
    try {
      await api.put('/user-matrix', { rows: newRows });
      setMatrixRows(newRows);
      setMatrixDirty(false);
    } catch (err) {
      setMatrixError(err.response?.data?.error || 'Failed to delete role.');
    }
  };

  const truncateId = (id) => id ? `${id.slice(0, 8)}…` : '—';

  return (
    <div className="unit-types-settings">
      <h3>Users &amp; Roles</h3>
      <p className="pagination-desc">Manage team members and their access rights.</p>

      {/* Inner tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 10, padding: 4, marginBottom: 24, width: 'fit-content' }}>
        {['users', 'roles', 'transfers-matrix', 'orders-matrix', 'notification-matrix'].map((t) => (
          <button
            key={t}
            onClick={() => { setActiveTab(t); if ((t === 'transfers-matrix' || t === 'roles') && !matrixRows) loadMatrix(); if (t === 'orders-matrix' && !ordersMatrixRows) loadOrdersMatrix(); if (t === 'notification-matrix' && !notifMatrixRows) loadNotifMatrix(); }}
            style={{
              padding: '7px 20px',
              border: 'none',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: activeTab === t ? 'var(--surface)' : 'transparent',
              color: activeTab === t ? 'var(--text)' : 'var(--text-3)',
              boxShadow: activeTab === t ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
              transition: 'all 0.15s',
              textTransform: 'capitalize',
            }}
          >
            {t === 'transfers-matrix' ? 'Transfers Matrix' : t === 'orders-matrix' ? 'Orders Matrix' : t === 'notification-matrix' ? 'Notification Matrix' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <>
          {error && <div className="msg-error" style={{ marginBottom: 16 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn-add btn-sm" onClick={openNew}>+ Add User</button>
          </div>

          {loading ? (
            <div style={{ padding: '20px 0', color: 'var(--text-4)' }}>Loading…</div>
          ) : users.length === 0 ? (
            <div className="ut-empty">No users yet. Add one above.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border-2)' }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Phone</th>
                    <th style={thStyle}>Rights</th>
                    <th style={{ ...thStyle, width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const rs = RIGHTS_STYLE[u.rights] || RIGHTS_STYLE['Member'];
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border-3)' }}>
                        <td style={tdStyle}><strong style={{ color: 'var(--text)' }}>{u.name}</strong></td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-4)' }} title={u.id}>{truncateId(u.id)}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-3)' }}>{u.email || '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-3)' }}>{u.phone || '—'}</td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, ...rs }}>
                            {u.rights || 'Member'}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <div className="action-btns">
                            <button className="btn-icon" onClick={() => openPwd(u)} title="Set Password" style={{ color: '#8b5cf6' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            </button>
                            <button className="btn-icon" onClick={() => openEdit(u)} title="Edit" style={{ color: '#3b82f6' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button className="btn-icon btn-delete" onClick={() => handleDelete(u)} title="Delete">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'roles' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn-add btn-sm" onClick={() => { if (!matrixRows) loadMatrix(); openRoleModal(null); }}>+ Add Role</button>
          </div>
          {!matrixRows ? (
            <div style={{ padding: '20px 0', color: 'var(--text-4)' }}>Loading…</div>
          ) : matrixRows.length === 0 ? (
            <div className="ut-empty">No roles yet. Add one above.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matrixRows.map((row, ri) => (
                <div key={ri} style={{ border: '1px solid var(--border-2)', borderRadius: 10, padding: '14px 18px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{row.role}</div>
                    {row.description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, fontStyle: 'italic' }}>{row.description}</div>}
                  </div>
                  <div className="action-btns">
                    <button className="btn-icon" onClick={() => openRoleModal(ri)} title="Edit" style={{ color: '#3b82f6' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="btn-icon btn-delete" onClick={() => handleDeleteRole(ri)} title="Delete">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'transfers-matrix' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
              Define permission levels for each role. {!canEditMatrix && <strong style={{ color: '#991b1b' }}>View only — Super Admin or Admin required to edit.</strong>}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {canEditMatrix && <button className="btn-add btn-sm" onClick={() => {
                const firstRole = matrixRows && matrixRows.length > 0 ? matrixRows[0].role : '';
                setMatrixRows(prev => [...(prev || []), { role: firstRole, description: '', initiate_transfer: 'No', approve_transfer: 'No', reject_transfer: 'No', view_transactions: 'No', cancel_transaction: 'No', set_limits: 'No', manage_users: 'No', audit_reports: 'No', transfer_limit: 'N/A' }]);
                setMatrixDirty(true);
              }}>+ Add Row</button>}
              {canEditMatrix && (
                <button className="btn-primary btn-sm" onClick={saveMatrix} disabled={!matrixDirty || matrixSaving}>
                  {matrixSaving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
          {matrixError && <div className="msg-error" style={{ marginBottom: 12 }}>{matrixError}</div>}
          {!matrixRows ? (
            <div style={{ padding: '20px 0', color: 'var(--text-4)' }}>Loading…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                    <th style={{ ...mxTh, minWidth: 160, textAlign: 'left' }}>Role</th>
                    <th style={{ ...mxTh, minWidth: 200, textAlign: 'left' }}>Description</th>
                    {PERMISSION_COLS.map(c => (
                      <th key={c.key} style={{ ...mxTh, minWidth: c.isText ? 120 : 100, textAlign: 'center' }}>{c.label}</th>
                    ))}
                    {canEditMatrix && <th style={{ ...mxTh, width: 40 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)', borderBottom: '1px solid var(--border-3)' }}>
                      <td style={{ ...mxTd, whiteSpace: 'nowrap' }}>
                        {canEditMatrix ? (
                          <select
                            value={row.role}
                            onChange={e => updateCell(ri, 'role', e.target.value)}
                            style={{ fontWeight: 700, fontSize: 13, border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 8px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 160 }}
                          >
                            {matrixRows.map((r, i) => (
                              <option key={i} value={r.role}>{r.role}</option>
                            ))}
                          </select>
                        ) : (
                          <strong style={{ color: 'var(--text)' }}>{row.role}</strong>
                        )}
                      </td>
                      <td style={{ ...mxTd, color: 'var(--text-3)', fontStyle: 'italic', fontSize: 12 }}>{row.description}</td>
                      {PERMISSION_COLS.map(c => {
                        const val = row[c.key] || (c.isText ? 'N/A' : 'No');
                        const color = PERM_COLORS[val] || {};
                        if (!canEditMatrix) {
                          return (
                            <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, ...color }}>{val}</span>
                            </td>
                          );
                        }
                        if (c.isText) {
                          return (
                            <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                              <input
                                value={val}
                                onChange={e => updateCell(ri, c.key, e.target.value)}
                                style={{ width: 90, textAlign: 'center', fontSize: 12, border: '1px solid var(--border-2)', borderRadius: 5, padding: '3px 6px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                            <select
                              value={val}
                              onChange={e => updateCell(ri, c.key, e.target.value)}
                              style={{ fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', ...color }}
                            >
                              {PERM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                        );
                      })}
                      {canEditMatrix && (
                        <td style={{ ...mxTd, textAlign: 'center' }}>
                          <button className="btn-icon btn-delete" onClick={() => handleDeleteRole(ri)} title="Remove role">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'orders-matrix' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
              Define permissions for creating and managing HR Orders. {!canEditMatrix && <strong style={{ color: '#991b1b' }}>View only.</strong>}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {canEditMatrix && <button className="btn-add btn-sm" onClick={() => {
                const firstRole = ordersMatrixRows && ordersMatrixRows.length > 0 ? ordersMatrixRows[0].role : '';
                setOrdersMatrixRows(prev => [...(prev || []), { role: firstRole, description: '', create_hiring: 'No', create_firing: 'No', create_promotion: 'No', create_adjusting: 'No', create_business_trip: 'No', view_orders: 'No' }]);
                setOrdersMatrixDirty(true);
              }}>+ Add Row</button>}
              {canEditMatrix && (
                <button className="btn-primary btn-sm" onClick={saveOrdersMatrix} disabled={!ordersMatrixDirty}>
                  Save Changes
                </button>
              )}
            </div>
          </div>
          {!ordersMatrixRows ? (
            <div style={{ padding: '20px 0', color: 'var(--text-4)' }}>Loading…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                    <th style={{ ...mxTh, minWidth: 160, textAlign: 'left' }}>Role</th>
                    <th style={{ ...mxTh, minWidth: 200, textAlign: 'left' }}>Description</th>
                    {ORDER_PERMISSION_COLS.map(c => (
                      <th key={c.key} style={{ ...mxTh, minWidth: 100, textAlign: 'center' }}>{c.label}</th>
                    ))}
                    {canEditMatrix && <th style={{ ...mxTh, width: 40 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {ordersMatrixRows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)', borderBottom: '1px solid var(--border-3)' }}>
                      <td style={{ ...mxTd, whiteSpace: 'nowrap' }}>
                        {canEditMatrix ? (
                          <select
                            value={row.role}
                            onChange={e => updateOrdersCell(ri, 'role', e.target.value)}
                            style={{ fontWeight: 700, fontSize: 13, border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 8px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 160 }}
                          >
                            {[...new Set([...RIGHTS, ...(matrixRows || []).map(r => r.role)])].map((r, i) => (
                              <option key={i} value={r}>{r}</option>
                            ))}
                          </select>
                        ) : (
                          <strong style={{ color: 'var(--text)' }}>{row.role}</strong>
                        )}
                      </td>
                      <td style={{ ...mxTd, color: 'var(--text-3)', fontStyle: 'italic', fontSize: 12 }}>{row.description}</td>
                      {ORDER_PERMISSION_COLS.map(c => {
                        const val = row[c.key] || 'No';
                        const color = PERM_COLORS[val] || {};
                        if (!canEditMatrix) {
                          return (
                            <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, ...color }}>{val}</span>
                            </td>
                          );
                        }
                        return (
                          <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                            <select
                              value={val}
                              onChange={e => updateOrdersCell(ri, c.key, e.target.value)}
                              style={{ fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', ...color }}
                            >
                              {PERM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                        );
                      })}
                      {canEditMatrix && (
                        <td style={{ ...mxTd, textAlign: 'center' }}>
                          <button className="btn-icon btn-delete" onClick={() => handleDeleteOrdersRole(ri)} title="Remove role">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'notification-matrix' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', maxWidth: 620 }}>
              Choose which roles get a <strong>WhatsApp</strong> message for each transfer event — in-app and email
              notifications already go out to the usual recipients regardless of this table. WhatsApp only actually
              sends if that person has personally linked their number under Options → WhatsApp.
              {!canEditMatrix && <strong style={{ color: '#991b1b' }}> View only — Super Admin or Admin required to edit.</strong>}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {canEditMatrix && <button className="btn-add btn-sm" onClick={() => {
                const firstRole = notifMatrixRows && notifMatrixRows.length > 0 ? notifMatrixRows[0].role : (matrixRows && matrixRows[0]?.role) || '';
                setNotifMatrixRows(prev => [...(prev || []), { role: firstRole, transfer_submitted: 'No', transfer_approved: 'No', transfer_rejected: 'No', transfer_partial: 'No', transfer_wait: 'No' }]);
                setNotifMatrixDirty(true);
              }}>+ Add Row</button>}
              {canEditMatrix && (
                <button className="btn-primary btn-sm" onClick={saveNotifMatrix} disabled={!notifMatrixDirty || notifMatrixSaving}>
                  {notifMatrixSaving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
          {notifMatrixError && <div className="msg-error" style={{ marginBottom: 12 }}>{notifMatrixError}</div>}
          {!notifMatrixRows ? (
            <div style={{ padding: '20px 0', color: 'var(--text-4)' }}>Loading…</div>
          ) : notifMatrixRows.length === 0 ? (
            <div className="ut-empty">No roles configured yet. Add one above to start routing WhatsApp alerts.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                    <th style={{ ...mxTh, minWidth: 160, textAlign: 'left' }}>Role</th>
                    {NOTIF_EVENT_COLS.map(c => (
                      <th key={c.key} style={{ ...mxTh, minWidth: 130, textAlign: 'center' }}>{c.label}</th>
                    ))}
                    {canEditMatrix && <th style={{ ...mxTh, width: 40 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {notifMatrixRows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)', borderBottom: '1px solid var(--border-3)' }}>
                      <td style={{ ...mxTd, whiteSpace: 'nowrap' }}>
                        {canEditMatrix ? (
                          <select
                            value={row.role}
                            onChange={e => updateNotifCell(ri, 'role', e.target.value)}
                            style={{ fontWeight: 700, fontSize: 13, border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 8px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 160 }}
                          >
                            {[...new Set([...RIGHTS, ...(matrixRows || []).map(r => r.role)])].map((r, i) => (
                              <option key={i} value={r}>{r}</option>
                            ))}
                          </select>
                        ) : (
                          <strong style={{ color: 'var(--text)' }}>{row.role}</strong>
                        )}
                      </td>
                      {NOTIF_EVENT_COLS.map(c => {
                        const val = row[c.key] || 'No';
                        const color = PERM_COLORS[val] || {};
                        if (!canEditMatrix) {
                          return (
                            <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, ...color }}>{val}</span>
                            </td>
                          );
                        }
                        return (
                          <td key={c.key} style={{ ...mxTd, textAlign: 'center' }}>
                            <select
                              value={val}
                              onChange={e => updateNotifCell(ri, c.key, e.target.value)}
                              style={{ fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', ...color }}
                            >
                              {NOTIF_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                        );
                      })}
                      {canEditMatrix && (
                        <td style={{ ...mxTd, textAlign: 'center' }}>
                          <button className="btn-icon btn-delete" onClick={() => handleDeleteNotifRole(ri)} title="Remove role">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {roleModal && createPortal(
        <div className="acc-modal-overlay" onClick={() => setRoleModal(null)}>
          <div className="acc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{roleModal.idx === null ? 'Add Role' : 'Edit Role'}</h3>
            {roleError && <div className="msg-error" style={{ marginBottom: 12 }}>{roleError}</div>}
            <div className="acc-form-grid">
              <div className="acc-form-group full">
                <label>Role Name *</label>
                <input value={roleModal.role} onChange={(e) => setRoleModal({ ...roleModal, role: e.target.value })} placeholder="e.g. Finance Controller" autoFocus />
              </div>
              <div className="acc-form-group full">
                <label>Description</label>
                <input value={roleModal.description} onChange={(e) => setRoleModal({ ...roleModal, description: e.target.value })} placeholder="Brief description of the role" />
              </div>
            </div>
            <div className="acc-modal-actions">
              <button className="ut-cancel-btn" onClick={() => setRoleModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveRole} disabled={roleSaving}>{roleSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {pwdModal && createPortal(
        <div className="acc-modal-overlay" onClick={() => setPwdModal(null)}>
          <div className="acc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Set Password — {pwdModal.name}</h3>
            {pwdError && <div className="msg-error" style={{ marginBottom: 12 }}>{pwdError}</div>}
            {pwdSuccess && <div className="msg-success" style={{ marginBottom: 12 }}>Password set successfully!</div>}
            <div className="acc-form-grid">
              <div className="acc-form-group full">
                <label>New Password</label>
                <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="At least 6 characters" autoFocus />
              </div>
              <div className="acc-form-group full">
                <label>Confirm Password</label>
                <input type="password" value={pwdConfirm} onChange={(e) => setPwdConfirm(e.target.value)} placeholder="Repeat password" />
              </div>
            </div>
            <div className="acc-modal-actions">
              <button className="ut-cancel-btn" onClick={() => setPwdModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleSetPassword} disabled={pwdSaving}>{pwdSaving ? 'Saving…' : 'Set Password'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showForm && createPortal(
        <div className="acc-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="acc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editId ? 'Edit User' : 'New User'}</h3>
            {error && <div className="msg-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="acc-form-grid">
              <div className="acc-form-group full">
                <label>Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. John Smith" />
              </div>
              {editId && (
                <div className="acc-form-group full">
                  <label>ID</label>
                  <input value={editId} readOnly style={{ background: 'var(--surface-2)', color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'default' }} />
                </div>
              )}
              <div className="acc-form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="e.g. john@example.com" />
              </div>
              <div className="acc-form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +995 555 000 000" />
              </div>
              <div className="acc-form-group full">
                <label>Rights</label>
                <select value={form.rights} onChange={(e) => setForm({ ...form, rights: e.target.value })}>
                  {(matrixRows ? matrixRows.map(r => r.role) : RIGHTS).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="acc-modal-actions">
              <button className="ut-cancel-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const thStyle = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--text-3)',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 14px',
  verticalAlign: 'middle',
};

const mxTh = {
  padding: '10px 12px',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: '0.3px',
  whiteSpace: 'nowrap',
};

const mxTd = {
  padding: '9px 12px',
  verticalAlign: 'middle',
};

export default UsersSettings;
