const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { resolveCaller, matrixRows, granted } = require('../middleware/permission');

// GET /api/user-matrix/permissions — current caller's effective permissions (always live from DB)
router.get('/permissions', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    const keys = ['initiate_transfer','approve_transfer','reject_transfer','view_transactions','cancel_transaction','set_limits','manage_users','audit_reports'];
    const all = { ...Object.fromEntries(keys.map((k) => [k, 'Yes'])), transfer_limit: 'Unlimited' };
    if (caller.missing) return res.json({ isOwner: false, role: null, ...Object.fromEntries(keys.map((k) => [k, 'No'])), transfer_limit: 'N/A' });

    // No role = company owner → all allowed
    if (!caller.role) return res.json({ isOwner: true, role: null, ...all });

    // Same rule as the server-side check: nothing blocked until the matrix is filled;
    // once it is, a role that isn't in it gets nothing.
    const { configured, rows } = await matrixRows('user_matrix', caller.ownerId, caller.role);
    if (!configured) return res.json({ isOwner: false, role: caller.role, ...all });

    // If duplicate rows exist for the same role, be permissive: Yes if ANY row says Yes
    const perms = {};
    keys.forEach(k => { perms[k] = granted(rows, k) ? 'Yes' : 'No'; });
    perms.transfer_limit = rows[0]?.transfer_limit || 'N/A';

    res.json({ isOwner: false, role: caller.role, ...perms });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/user-matrix
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_matrix')
      .select('*')
      .eq('user_id', req.userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ rows: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/user-matrix
router.put('/', async (req, res) => {
  try {
    // Only the owner, Super Admins and Admins may change who can do what
    const caller = await resolveCaller(req);
    if (caller.missing || (caller.role && caller.role !== 'Super Admin' && caller.role !== 'Admin')) {
      return res.status(403).json({ error: 'Only an admin can change the Transfers Matrix.' });
    }
    const { rows } = req.body;
    const { error: delErr } = await supabase
      .from('user_matrix')
      .delete()
      .eq('user_id', req.userId);
    if (delErr) throw delErr;

    if (rows && rows.length > 0) {
      const inserts = rows.map((r, i) => ({
        user_id: req.userId,
        sort_order: i,
        role: r.role,
        description: r.description || '',
        initiate_transfer: r.initiate_transfer || 'No',
        approve_transfer: r.approve_transfer || 'No',
        reject_transfer: r.reject_transfer || 'No',
        view_transactions: r.view_transactions || 'No',
        cancel_transaction: r.cancel_transaction || 'No',
        set_limits: r.set_limits || 'No',
        manage_users: r.manage_users || 'No',
        audit_reports: r.audit_reports || 'No',
        transfer_limit: r.transfer_limit || 'N/A',
      }));
      const { error: insErr } = await supabase.from('user_matrix').insert(inserts);
      if (insErr) throw insErr;
    }

    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
