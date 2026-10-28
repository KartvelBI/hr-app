const supabase = require('../config/supabase');

// Who is calling: their role (app_users.rights) and the company owner's id
// their data lives under. role === null means the company owner (all rights).
const resolveCaller = async (req) => {
  let role = req.userRights || null;
  let ownerId = req.userId;

  // For member accounts (custom JWT), always read live rights from DB
  // to avoid stale JWT after an admin changes the member's role.
  if (req.appUserId) {
    const { data: appUser } = await supabase
      .from('app_users')
      .select('rights, user_id')
      .eq('id', req.appUserId)
      .maybeSingle();
    if (!appUser) return { missing: true };
    return { role: appUser.rights, ownerId: appUser.user_id };
  }

  // For Supabase-authenticated users, look up their role from app_users.
  // Sub-users are stored with the OWNER's user_id, so query by email only.
  if (!role && req.user?.email) {
    const { data: appUser } = await supabase
      .from('app_users')
      .select('rights, user_id')
      .eq('email', req.user.email)
      .maybeSingle();
    if (appUser) { role = appUser.rights; ownerId = appUser.user_id; }
  }
  return { role, ownerId };
};

// Rows for a role in a permission matrix table. configured = the company has
// filled the matrix at all; until then nothing is blocked (nothing was set up).
const matrixRows = async (table, ownerId, role) => {
  const { count, error: countErr } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ownerId);
  // Table not created yet (migration not run): behave as "not set up" rather than break every order
  if (countErr && /does not exist|schema cache|relation/i.test(countErr.message || '')) return { configured: false, rows: [] };
  if (countErr) throw countErr;
  if (!count) return { configured: false, rows: [] };
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', ownerId)
    .eq('role', role)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return { configured: true, rows: data || [] };
};

// A permission is granted unless the value is No / empty. Several rows for the
// same role: granted if any of them grants it.
const granted = (rows, key) => rows.some((r) => r[key] != null && r[key] !== '' && r[key] !== 'No');

const makeCheck = (table) => (permissionKey) => async (req, res, next) => {
  try {
    const caller = await resolveCaller(req);
    if (caller.missing) return res.status(403).json({ error: 'Member account not found.' });
    if (caller.ownerId) req.userId = caller.ownerId;
    // No role found: this is the company owner (Super Admin), always allowed
    if (!caller.role) return next();

    const { configured, rows } = await matrixRows(table, req.userId, caller.role);
    if (!configured) return next();
    if (!granted(rows, permissionKey)) {
      return res.status(403).json({ error: `Your role "${caller.role}" is not permitted to perform this action.` });
    }

    req.permissionValue = rows.find((r) => granted([r], permissionKey))[permissionKey];
    req.permissionRow = rows[0];
    req.resolvedRole = caller.role;
    next();
  } catch (err) {
    console.error('[permission] middleware error:', err);
    res.status(500).json({ error: `Permission check failed: ${err.message}` });
  }
};

// Transfers Matrix (user_matrix) and Orders Matrix (orders_matrix)
const checkPermission = makeCheck('user_matrix');
const checkOrderPermission = makeCheck('orders_matrix');

module.exports = { checkPermission, checkOrderPermission, resolveCaller, matrixRows, granted };
