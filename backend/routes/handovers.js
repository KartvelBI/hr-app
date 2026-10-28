const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { resolveUserName } = require('../services/userIdentity');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('handover_orders')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { from_employee_id, to_employee_id, handover_date, items, notes } = req.body;
    if (!from_employee_id || !to_employee_id || !handover_date) {
      return res.status(400).json({ error: 'from_employee_id, to_employee_id and handover_date are required' });
    }
    const created_by_name = await resolveUserName(req);
    const { data, error } = await supabase.from('handover_orders').insert([{
      user_id: req.userId,
      from_employee_id,
      to_employee_id,
      handover_date,
      items: items || null,
      notes: notes || null,
      created_by_name,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { from_employee_id, to_employee_id, handover_date, items, notes } = req.body;
    const { data, error } = await supabase.from('handover_orders').update({
      from_employee_id, to_employee_id, handover_date,
      items: items || null,
      notes: notes || null,
    }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('handover_orders').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
