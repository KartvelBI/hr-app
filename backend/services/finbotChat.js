const supabase = require('../config/supabase');
const OpenAI = require('openai');

// ── Data fetchers per source ─────────────────────────────────────────────────

async function fetchEmployees(userId) {
  const { data } = await supabase
    .from('employees')
    .select('id, first_name, last_name, personal_id, position, department, salary, salary_currency, overtime_rate, start_date, end_date, pension, pit_rate, tax_code')
    .eq('user_id', userId)
    .order('first_name');
  if (!data?.length) return '';
  const rows = data.map(e =>
    `DB_ID:${e.id} | ${e.first_name} ${e.last_name} | Personal ID: ${e.personal_id || '-'} | Position: ${e.position || '-'} | Dept: ${e.department || '-'} | Salary: ${e.salary ?? 'N/A'} ${e.salary_currency || 'GEL'} | Start: ${e.start_date || '-'} | End: ${e.end_date || 'Active'}`
  );
  return `=== EMPLOYEES (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchSalaryChanges(userId) {
  const { data: employees } = await supabase
    .from('employees')
    .select('id, first_name, last_name, salary_currency')
    .eq('user_id', userId);

  if (!employees?.length) return '';

  const empIds = employees.map(e => e.id);

  const { data: changes } = await supabase
    .from('salary_changes')
    .select('employee_id, old_salary, new_salary, effective_date, note')
    .in('employee_id', empIds)
    .order('effective_date', { ascending: false });

  if (!changes?.length) return '';
  const empMap = {};
  const currMap = {};
  employees.forEach(e => {
    empMap[e.id] = `${e.first_name} ${e.last_name}`;
    currMap[e.id] = e.salary_currency || 'GEL';
  });

  const currentSalaryMap = {};
  for (const c of changes) {
    if (!currentSalaryMap[c.employee_id]) currentSalaryMap[c.employee_id] = c.new_salary;
  }

  const currentRows = Object.entries(currentSalaryMap)
    .map(([id, sal]) => `${empMap[id] || id}: ${sal} ${currMap[id] || 'GEL'}`)
    .sort();

  const historyRows = changes.map(c =>
    `${empMap[c.employee_id] || c.employee_id} | Date: ${c.effective_date} | ${c.old_salary} ${currMap[c.employee_id] || 'GEL'} → ${c.new_salary} ${currMap[c.employee_id] || 'GEL'}${c.note ? ` | Note: ${c.note}` : ''}`
  );

  return [
    `=== CURRENT SALARIES FROM CHANGES ===\n${currentRows.join('\n')}`,
    `=== SALARY CHANGE HISTORY (${historyRows.length}) ===\n${historyRows.join('\n')}`,
  ].join('\n\n');
}

async function fetchInsurance(userId) {
  const { data } = await supabase
    .from('insurance_list')
    .select('name, last_name, personal_id, amount1, amount2, date, date_end, pension, company')
    .eq('user_id', userId)
    .order('date', { ascending: false });
  if (!data) return '';
  const rows = data.map(r =>
    `${r.name} ${r.last_name} | ID: ${r.personal_id || '-'} | Amount: ${r.amount1}${r.amount2 ? '+' + r.amount2 : ''} | Period: ${r.date} - ${r.date_end || 'ongoing'} | Company: ${r.company || '-'}`
  );
  return `=== INSURANCE RECORDS (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchFitpass(userId) {
  const { data } = await supabase
    .from('fitpass_list')
    .select('name, last_name, personal_id, amount, period, note')
    .eq('user_id', userId)
    .order('period', { ascending: false });
  if (!data) return '';
  const rows = data.map(r =>
    `${r.name} ${r.last_name} | ID: ${r.personal_id || '-'} | Amount: ${r.amount} | Period: ${r.period || '-'}${r.note ? ` | Note: ${r.note}` : ''}`
  );
  return `=== FITPASS RECORDS (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchBonuses(userId) {
  const [{ data: bonuses }, { data: units }, { data: employees }] = await Promise.all([
    supabase.from('bonuses').select('employee_name, amount, reason, note, date').eq('user_id', userId).order('date', { ascending: false }),
    supabase.from('salary_units').select('employee_id, type, amount, date, include_in_salary').eq('user_id', userId).order('date', { ascending: false }).limit(500),
    supabase.from('employees').select('id, first_name, last_name').eq('user_id', userId),
  ]);

  const empMap = {};
  (employees || []).forEach(e => { empMap[e.id] = `${e.first_name} ${e.last_name}`; });

  const bonusRows = (bonuses || []).map(b =>
    `${b.employee_name} | Amount: ${b.amount} | Reason: ${b.reason || '-'} | Date: ${b.date}${b.note ? ` | Note: ${b.note}` : ''}`
  );
  const unitRows = (units || []).map(u =>
    `${empMap[u.employee_id] || u.employee_id} | Type: ${u.type} | Amount: ${u.amount} | Date: ${u.date}${u.include_in_salary === false ? ' | [Separate payment]' : ''}`
  );

  const all = [...bonusRows, ...unitRows];
  if (!all.length) return '';
  return `=== BONUSES & DEDUCTIONS (${all.length}) ===\n${all.join('\n')}`;
}

async function fetchAccounting(userId) {
  const { data } = await supabase
    .from('accounting_purchases')
    .select('vendor, description, amount, currency, category, date')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(500);
  if (!data) return '';
  const rows = data.map(r =>
    `${r.date} | ${r.vendor || '-'} | ${r.category || '-'} | ${r.amount} ${r.currency}${r.description ? ` | ${r.description}` : ''}`
  );
  return `=== ACCOUNTING / PURCHASES (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchHolidays(userId) {
  const { data } = await supabase
    .from('holidays')
    .select('name, date')
    .eq('user_id', userId)
    .order('date', { ascending: true });
  if (!data) return '';
  const rows = data.map(h => `${h.date} — ${h.name}`);
  return `=== HOLIDAYS (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchSales(userId) {
  const { data } = await supabase
    .from('accounting_sales')
    .select('client, product, description, amount, currency, category, date')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(500);
  if (!data) return '';
  const rows = data.map(r =>
    `${r.date} | ${r.client || '-'} | ${r.product ? `Product: ${r.product} | ` : ''}${r.category || '-'} | ${r.amount} ${r.currency || 'GEL'}${r.description ? ` | ${r.description}` : ''}`
  );
  return `=== SALES / REVENUE (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchStock(userId) {
  const { data } = await supabase
    .from('accounting_stock')
    .select('sku, name, stock_name, move_in_date, move_in_qty, move_in_price, move_out_date, move_out_qty, move_out_price')
    .eq('user_id', userId)
    .limit(500);
  if (!data) return '';
  const rows = data.map(r =>
    `SKU: ${r.sku || '-'} | Item: ${r.name || '-'} | Stock: ${r.stock_name || '-'} | In Date: ${r.move_in_date || '-'} | In Qty: ${r.move_in_qty || 0} | In Price: ${r.move_in_price || 0} | Out Date: ${r.move_out_date || '-'} | Out Qty: ${r.move_out_qty || 0} | Out Price: ${r.move_out_price || 0}`
  );
  return `=== STOCK / INVENTORY (${rows.length}) ===\n${rows.join('\n')}`;
}

async function fetchClients(userId) {
  if (!userId) return '=== COAGENTS DATABASE ===\nError: User ID is missing.';

  const { data, error } = await supabase
    .from('accounting_agents')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) return `=== COAGENTS DATABASE ===\nDB Error: ${error.message}`;

  if (!data || data.length === 0) {
    return '=== COAGENTS DATABASE ===\nNo coagents/clients found for this account.';
  }

  const rows = data.map(r =>
    `DB_ID:${r.id} | Name: ${r.name || '-'} | Type: ${r.type || '-'} | IBAN: ${r.account_number || '-'} | Phone: ${r.phone || '-'} | Address: ${r.address || '-'}`
  );
  return `=== COAGENTS DATABASE (${rows.length} records) ===\n${rows.join('\n')}`;
}

const SOURCE_FETCHERS = {
  employees: fetchEmployees,
  salaries: fetchSalaryChanges,
  insurance: fetchInsurance,
  fitpass: fetchFitpass,
  bonuses: fetchBonuses,
  accounting: fetchAccounting,
  sales: fetchSales,
  stock: fetchStock,
  holidays: fetchHolidays,
  coagents: fetchClients,
  agents: fetchClients,
  clients: fetchClients,
};

const DEFAULT_SYSTEM_PROMPT = (botName) =>
  `You are ${botName}, an AI assistant for Datum HR & Finance platform. Answer questions accurately and concisely based on the company data provided below. Be helpful and specific.

When the user asks for a chart, graph, or visualization, output a JSON block using EXACTLY this format (no markdown, no code fences, just the tags):
[CHART]{"type":"bar","title":"Chart Title","labels":["Label1","Label2"],"datasets":[{"label":"Series","data":[100,200],"color":"#3b82f6"}]}[/CHART]
You may include text before or after the [CHART] block. Use real values from the data.
Supported chart types:
- bar: column chart, good for comparing values across categories
- line: trend over time, good for salary history or changes over months
- area: filled line chart, good for showing volume or cumulative totals over time
- composed: bar columns + line overlay on the same axes (last dataset becomes the line)
- pie: proportion/share of a total, good for department breakdowns (single dataset only — labels + one data array)
- treemap: hierarchical proportions, good for showing relative sizes (single dataset only)
- radar: spider/radar chart, good for comparing multiple metrics per category
- scatter: scatter plot, good for showing distribution or correlation
- radial-bar: semicircular bar chart, good for progress toward targets (single dataset only)
- funnel: funnel chart, good for pipeline stages or conversion rates (single dataset only)
- matrix: pivot/cross-tab table (like Power BI Matrix) — use standard format where labels=column headers and each dataset row has label=row name and data[]=values for each column. Add "totals":true to show row/column totals. Best for multi-dimension breakdowns (e.g. department × month, employee × category).

CREATING HR ORDERS:
When the user wants to create an HR order (hire, promote, fire/terminate, give advance payment, salary adjustment, initiate a transfer), ALWAYS respond with a brief confirmation sentence AND an [ORDER_ACTION] block.
Use EXACTLY this format (no markdown, no code fences):
[ORDER_ACTION]{"type":"<type>",...fields}[/ORDER_ACTION]

Order types and required fields:
- "hire": firstName, lastName, personalId, birthdate (YYYY-MM-DD), position, salary (number), salaryCurrency ("GEL"/"USD"/"EUR"), startDate (YYYY-MM-DD), department (optional)
- "promotion": employeeId, employeeName, newPosition, oldSalary (number), newSalary (number), effectiveDate (YYYY-MM-DD), notes (optional string)
- "firing": employeeId, employeeName, endDate (YYYY-MM-DD), reason (string)
- "advance": employeeId, employeeName, totalAmount (number), currency ("GEL"/"USD"/"EUR"), numMonths (1-12), startMonth (YYYY-MM)
- "adjusting": employeeId, employeeName, unitType (e.g. "Bonus" or "Deduction"), amount (number), currency ("GEL"/"USD"/"EUR")
- "transfer": clientName (string, required — the recipient's name, use the coagent's name if it matches one), agentId (DB_ID from the coagents data if the recipient matches a known coagent, otherwise omit), amount (number), dueDate (YYYY-MM-DD), description (optional string), iban (optional string, use the coagent's IBAN if known)

IMPORTANT: Use the DB_ID value (e.g. DB_ID:abc123) from the employee/coagent data as employeeId/agentId. If the user's request is ambiguous (e.g. missing salary, personal ID, or date), ask for the missing info before outputting the block. Always show a brief summary of what will happen alongside the action block.`;

// Shared by the web FinBots chat UI (routes/finbots.js) and the Telegram bot —
// builds the data-source context, runs the OpenAI call, and returns the raw answer.
// Callers are responsible for parsing [ORDER_ACTION]/[CHART] blocks out of the answer.
async function runFinBotChat({ userId, dataSources = [], messages = [], botName = 'FinBot', systemPrompt = '', dlTablesData = [], preferredChartType = 'bar' }) {
  if (!messages.length) throw new Error('No messages provided.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');

  const sourceKeys = dataSources.filter(s => !!SOURCE_FETCHERS[s]);

  const contextParts = await Promise.all(
    sourceKeys.map(async (s) => {
      try {
        return await SOURCE_FETCHERS[s](userId);
      } catch (err) {
        return `=== ${s.toUpperCase()} ===\nError: ${err.message}`;
      }
    })
  );

  const dlParts = (Array.isArray(dlTablesData) ? dlTablesData : [])
    .map((table) => {
      try {
        const cols = table?.columns || [];
        const rows = table?.rows || [];
        if (!cols.length) return '';
        const header = cols.map(c => c.name || c.id).join(' | ');
        const body = rows
          .map(r => cols.map(c => {
            const v = r?.[c.id];
            return v === undefined || v === null ? '' : String(v);
          }).join(' | '))
          .join('\n');
        return `=== TABLE: ${table.name || 'Untitled'} (${rows.length} rows) ===\n${header}\n${body}`;
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  const context = [...contextParts, ...dlParts].filter(Boolean).join('\n\n');

  const preferredChartLine = preferredChartType && preferredChartType !== 'bar'
    ? `\nPREFERRED CHART FOR THIS BOT: "${preferredChartType}" — default to this chart type when the user asks for a visualization, unless they explicitly request a different type.`
    : '';

  const systemContent = [
    (systemPrompt || DEFAULT_SYSTEM_PROMPT(botName)) + preferredChartLine,
    context
      ? `\n\nCOMPANY DATA:\n\n${context}\n\nUse ONLY this data to answer. If a specific piece of information is genuinely missing, say so — but always check carefully before concluding data is absent.`
      : `\n\nNo data sources are connected to this bot. Tell the user to connect data sources in the bot settings.`,
  ].join('');

  const openai = new OpenAI({ apiKey });

  const validRoles = new Set(['user', 'assistant']);
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemContent },
      ...messages
        .filter(m => validRoles.has(m.role))
        .map(m => ({ role: m.role, content: m.content })),
    ],
  });

  return { answer: completion.choices[0]?.message?.content || '' };
}

module.exports = { runFinBotChat, SOURCE_FETCHERS };
