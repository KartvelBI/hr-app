-- Per-role permissions for HR orders (Users & Roles → Orders Matrix).
-- Used to live only in each browser's localStorage, so it never reached other
-- users and the server couldn't enforce it. Mirrors user_matrix's shape
-- (delete-all + reinsert on save from the frontend).
CREATE TABLE IF NOT EXISTS orders_matrix (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL,
  description TEXT DEFAULT '',
  create_hiring TEXT DEFAULT 'No',
  create_firing TEXT DEFAULT 'No',
  create_promotion TEXT DEFAULT 'No',
  create_adjusting TEXT DEFAULT 'No',
  create_business_trip TEXT DEFAULT 'No',
  create_advance_payment TEXT DEFAULT 'No',
  create_bonus TEXT DEFAULT 'No',
  create_handover TEXT DEFAULT 'No',
  view_orders TEXT DEFAULT 'No'
);

CREATE INDEX IF NOT EXISTS idx_orders_matrix_user_id ON orders_matrix(user_id);

NOTIFY pgrst, 'reload schema';
