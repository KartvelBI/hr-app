const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { resolveUserName } = require('../services/userIdentity');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('promotion_orders')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { employee_id, old_position, new_position, old_salary, new_salary, effective_date, notes, salary_change_id } = req.body;
    if (!employee_id || !new_position || !new_salary) {
      return res.status(400).json({ error: 'employee_id, new_position and new_salary are required' });
    }
    const created_by_name = await resolveUserName(req);
    const { data, error } = await supabase.from('promotion_orders').insert([{
      user_id: req.userId,
      employee_id, old_position: old_position || null, new_position,
      old_salary: old_salary || null, new_salary,
      effective_date: effective_date || null, notes: notes || null,
      salary_change_id: salary_change_id || null,
      created_by_name,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { employee_id, old_position, new_position, old_salary, new_salary, effective_date, notes } = req.body;
    const { data, error } = await supabase.from('promotion_orders').update({
      employee_id, old_position: old_position || null, new_position,
      old_salary: old_salary || null, new_salary,
      effective_date: effective_date || null, notes: notes || null,
    }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('promotion_orders').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
