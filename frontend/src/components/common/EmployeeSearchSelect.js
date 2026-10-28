import React, { useState, useEffect, useRef } from 'react';

const INPUT = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--border-2)', background: 'var(--surface-2)',
  color: 'var(--text)', fontSize: 13, boxSizing: 'border-box', outline: 'none',
};

// Searchable employee dropdown shared by every "add an order" form (Documents >
// Orders, and the floating quick-add) so they present the exact same picker
// instead of drifting into a plain <select> in one place and this in another.
export default function EmployeeSearchSelect({ employees, value, onChange, placeholder = 'Select employee…', excludeId, required }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const pool = excludeId ? employees.filter(e => String(e.id) !== String(excludeId)) : employees;
  const selected = pool.find(e => String(e.id) === String(value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? pool.filter(e => `${e.first_name} ${e.last_name}`.toLowerCase().includes(q))
    : pool;

  const pick = (id) => {
    onChange({ target: { value: id } });
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Hidden input carries HTML5 required validation without a visible native select */}
      {required && <input tabIndex={-1} value={value || ''} onChange={() => {}} required style={{ position: 'absolute', opacity: 0, height: 0, width: '100%', pointerEvents: 'none' }} />}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ ...INPUT, width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <span style={{ color: selected ? 'var(--text)' : 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? `${selected.first_name} ${selected.last_name}` : placeholder}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
          background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 9,
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 280,
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-2)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Search employee…"
              style={{ ...INPUT, padding: '6px 10px', fontSize: 13 }}
            />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {value && (
              <div
                onClick={() => pick('')}
                style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--text-3)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                — Clear selection —
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-4)', textAlign: 'center' }}>No matches</div>
            ) : filtered.map(e => {
              const isSel = String(value) === String(e.id);
              return (
                <div
                  key={e.id}
                  onClick={() => pick(e.id)}
                  style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontWeight: isSel ? 700 : 500, background: isSel ? 'var(--surface-2)' : 'transparent' }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = isSel ? 'var(--surface-2)' : 'transparent'}
                >
                  {e.first_name} {e.last_name}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
