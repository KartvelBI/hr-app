const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// GET /api/user-matrix/permissions — current caller's effective permissions (always live from DB)
router.get('/permissions', async (req, res) => {
  try {
    let role = null;
    let ownerId = req.userId;

    if (req.appUserId) {
      // Member JWT — read live role from app_users
      const { data: appUser } = await supabase
        .from('app_users').select('rights, user_id').eq('id', req.appUserId).maybeSingle();
      if (appUser) { role = appUser.rights; ownerId = appUser.user_id; }
    } else if (req.user?.email) {
      // Supabase sub-user — look up by email
      const { data: appUser } = await supabase
        .from('app_users').select('rights, user_id').eq('email', req.user.email).maybeSingle();
      if (appUser) { role = appUser.rights; ownerId = appUser.user_id; }
    }

    const all = { initiate_transfer: 'Yes', approve_transfer: 'Yes', reject_transfer: 'Yes', view_transactions: 'Yes', cancel_transaction: 'Yes', set_limits: 'Yes', manage_users: 'Yes', audit_reports: 'Yes' };

    // No role = company owner → all allowed
    if (!role) return res.json({ isOwner: true, role: null, ...all });

    const { data: rows } = await supabase
      .from('user_matrix').select('*').eq('user_id', ownerId).eq('role', role)
      .order('sort_order', { ascending: true });

    // Role not in matrix → default allow
    if (!rows || rows.length === 0) return res.json({ isOwner: false, role, ...all });

    // If duplicate rows exist for the same role, be permissive: Yes if ANY row says Yes
    const keys = ['initiate_transfer','approve_transfer','reject_transfer','view_transactions','cancel_transaction','set_limits','manage_users','audit_reports'];
    const perms = {};
    keys.forEach(k => { perms[k] = rows.some(r => r[k] !== 'No') ? 'Yes' : 'No'; });

    res.json({ isOwner: false, role, ...perms });
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
