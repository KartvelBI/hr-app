const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { resolveCaller, matrixRows, granted } = require('../middleware/permission');

const KEYS = [
  'create_hiring', 'create_firing', 'create_promotion', 'create_adjusting',
  'create_business_trip', 'create_advance_payment', 'create_bonus', 'create_handover', 'view_orders',
];

// GET /api/orders-matrix/permissions — current caller's effective order permissions (always live from DB)
router.get('/permissions', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    const all = Object.fromEntries(KEYS.map((k) => [k, 'Yes']));
    if (caller.missing) return res.json({ isOwner: false, role: null, configured: true, ...Object.fromEntries(KEYS.map((k) => [k, 'No'])) });
    // No role = company owner → all allowed
    if (!caller.role) return res.json({ isOwner: true, role: null, configured: true, ...all });

    const { configured, rows } = await matrixRows('orders_matrix', caller.ownerId, caller.role);
    // Matrix not set up yet → nothing is blocked (same rule as the server-side check)
    if (!configured) return res.json({ isOwner: false, role: caller.role, configured: false, ...all });

    const perms = {};
    KEYS.forEach((k) => {
      const hit = rows.find((r) => granted([r], k));
      perms[k] = hit ? hit[k] : 'No';
    });
    res.json({ isOwner: false, role: caller.role, configured: true, ...perms });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/orders-matrix
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders_matrix')
      .select('*')
      .eq('user_id', req.userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ rows: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/orders-matrix — only the owner, Super Admins and Admins may change it
router.put('/', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (caller.missing || (caller.role && caller.role !== 'Super Admin' && caller.role !== 'Admin')) {
      return res.status(403).json({ error: 'Only an admin can change the Orders Matrix.' });
    }
    const ownerId = caller.ownerId || req.userId;
    const { rows } = req.body;
    const { error: delErr } = await supabase.from('orders_matrix').delete().eq('user_id', ownerId);
    if (delErr) throw delErr;

    if (rows && rows.length > 0) {
      const inserts = rows.map((r, i) => ({
        user_id: ownerId,
        sort_order: i,
        role: r.role,
        description: r.description || '',
        ...Object.fromEntries(KEYS.map((k) => [k, r[k] || 'No'])),
      }));
      const { error: insErr } = await supabase.from('orders_matrix').insert(inserts);
      if (insErr) throw insErr;
    }

    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
