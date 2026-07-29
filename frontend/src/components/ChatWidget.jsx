import { useState, useRef, useEffect } from 'react';
import { queryAssistant } from '../api/client';

// One session per browser tab, same pattern JobContext uses for jobId —
// lets the assistant's multi-turn history (kept server-side in
// conversationStore) survive navigation between pages but reset on a
// fresh tab, without a login system to key it off instead.
function getSessionId() {
  let id = sessionStorage.getItem('assistantSessionId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('assistantSessionId', id);
  }
  return id;
}

const GREETING = {
  role: 'assistant',
  content: 'Ask me about your ingestion runs — e.g. "Show me all files below 80% quality" or "Why did yesterday\'s Meta upload fail?"',
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sessionId = useRef(getSessionId());
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;

    setMessages((m) => [...m, { role: 'user', content: message }]);
    setInput('');
    setSending(true);

    try {
      const result = await queryAssistant(sessionId.current, message);
      setMessages((m) => [...m, { role: 'assistant', content: result.answer, path: result.path, sources: result.sources }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', content: e.message }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Ask the ingestion assistant"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'var(--brand)',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-4-1L3 20l1-4.5A8.5 8.5 0 1 1 21 11.5Z" />
        </svg>
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 360,
        maxHeight: 520,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
        overflow: 'hidden',
        zIndex: 1000,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Ingestion Assistant</p>
          <p style={{ fontSize: 11, color: 'var(--ink-secondary)', margin: '2px 0 0' }}>Ask about past runs</p>
        </div>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 16, color: 'var(--ink-secondary)', lineHeight: 1, padding: 4 }}>
          ✕
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 200 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div
              style={{
                background: m.role === 'user' ? 'var(--brand)' : m.role === 'error' ? 'var(--rejected-bg)' : 'var(--bg)',
                color: m.role === 'user' ? 'white' : m.role === 'error' ? 'var(--rejected-fg)' : 'var(--ink)',
                fontSize: 13,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
            {m.path && (
              <p className="mono" style={{ fontSize: 10, color: 'var(--ink-secondary)', margin: '4px 2px 0' }}>
                {m.path === 'structured' ? 'exact match · job history' : 'semantic · vector search'}
              </p>
            )}
            {m.sources?.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--ink-secondary)', margin: '2px 2px 0' }}>
                Sources: {m.sources.map((s) => s.fileName).join(', ')}
              </p>
            )}
          </div>
        ))}
        {sending && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--ink-secondary)', padding: '8px 12px' }}>Thinking…</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '0.5px solid var(--border)' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your uploads…"
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: 'var(--font-display)',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          style={{
            background: 'var(--brand)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '0 14px',
            fontSize: 13,
            fontWeight: 500,
            opacity: sending || !input.trim() ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
