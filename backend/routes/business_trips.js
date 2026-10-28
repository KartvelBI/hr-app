const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { resolveUserName } = require('../services/userIdentity');

router.get('/', async (req, res) => {
  try {
    const { data: trips, error } = await supabase
      .from('business_trip_orders')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const { data: costs, error: costsError } = await supabase
      .from('business_trip_costs')
      .select('trip_id, amount')
      .eq('user_id', req.userId);
    if (costsError) throw costsError;

    const totalsByTrip = {};
    (costs || []).forEach((c) => {
      totalsByTrip[c.trip_id] = (totalsByTrip[c.trip_id] || 0) + parseFloat(c.amount || 0);
    });

    const withTotals = (trips || []).map((t) => ({ ...t, total_costs: totalsByTrip[t.id] || 0 }));
    res.json({ records: withTotals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const {
      employee_id, group_id, group_name, from_date, to_date,
      country_code, country_name, city_name, per_diem, amount, days, notes,
    } = req.body;
    if (!employee_id || !from_date || !to_date) {
      return res.status(400).json({ error: 'employee_id, from_date and to_date are required' });
    }
    const created_by_name = await resolveUserName(req);
    const { data, error } = await supabase.from('business_trip_orders').insert([{
      user_id: req.userId,
      employee_id, group_id: group_id || null, group_name: group_name || null,
      from_date, to_date,
      country_code: country_code || null, country_name: country_name || null, city_name: city_name || null,
      per_diem: per_diem || null, amount: amount || null, days: days || null,
      notes: notes || null,
      created_by_name,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: { ...data, total_costs: 0 } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      employee_id, group_id, group_name, from_date, to_date,
      country_code, country_name, city_name, per_diem, amount, days, notes,
    } = req.body;
    const { data, error } = await supabase.from('business_trip_orders').update({
      employee_id, group_id: group_id || null, group_name: group_name || null,
      from_date, to_date,
      country_code: country_code || null, country_name: country_name || null, city_name: city_name || null,
      per_diem: per_diem || null, amount: amount || null, days: days || null,
      notes: notes || null,
    }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('business_trip_orders').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cost line items (receipts) attached to a trip
router.get('/:id/costs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('business_trip_costs')
      .select('*')
      .eq('trip_id', req.params.id)
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/costs', async (req, res) => {
  try {
    const { name, amount, file_name, file_type, file_data } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabase.from('business_trip_costs').insert([{
      user_id: req.userId,
      trip_id: req.params.id,
      name, amount: amount || null,
      file_name: file_name || null, file_type: file_type || null, file_data: file_data || null,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/costs/:costId', async (req, res) => {
  try {
    const { error } = await supabase.from('business_trip_costs').delete()
      .eq('id', req.params.costId).eq('trip_id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
