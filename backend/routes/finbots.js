const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { runFinBotChat } = require('../services/finbotChat');

// ── CRUD for bots themselves ──────────────────────────────────────────────────

// GET /api/finbots — List all bots for the user
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('finbots')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ bots: data || [] });
  } catch (err) {
    console.error('Fetch bots error:', err);
    res.status(500).json({ error: 'Failed to fetch bots: ' + err.message });
  }
});

// POST /api/finbots — Create or Update a bot
router.post('/', async (req, res) => {
  try {
    const { id, name, description, dataSources, systemPrompt, color, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Bot name is required.' });

    const botData = {
      user_id: req.userId,
      name,
      description,
      data_sources: dataSources,
      system_prompt: systemPrompt,
      color,
      icon,
      updated_at: new Date().toISOString(),
    };

    if (id && !id.startsWith('temp_')) {
      // Update
      const { data, error } = await supabase
        .from('finbots')
        .update(botData)
        .eq('id', id)
        .eq('user_id', req.userId)
        .select()
        .single();
      if (error) throw error;
      return res.json({ bot: data });
    } else {
      // Create
      const { data, error } = await supabase
        .from('finbots')
        .insert([{ ...botData, created_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return res.json({ bot: data });
    }
  } catch (err) {
    console.error('Save bot error:', err);
    res.status(500).json({ error: 'Failed to save bot: ' + err.message });
  }
});

// DELETE /api/finbots/:id — Delete a bot
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('finbots')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete bot error:', err);
    res.status(500).json({ error: 'Failed to delete bot: ' + err.message });
  }
});

// ── POST /api/finbots/chat ───────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { dataSources = [], messages = [], botName = 'FinBot', systemPrompt = '', dlTablesData = [], preferredChartType = 'bar' } = req.body;
    if (!messages.length) return res.status(400).json({ error: 'No messages provided.' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    const result = await runFinBotChat({ userId: req.userId, dataSources, messages, botName, systemPrompt, dlTablesData, preferredChartType });
    res.json(result);
  } catch (err) {
    console.error('FinBot chat error:', err);
    res.status(500).json({ error: 'Failed to get answer: ' + (err.message || 'Unknown error') });
  }
});

module.exports = router;
