/* query.js — AI query window */

let history = [];
let isAnalysing = false;

const chatWindow  = document.getElementById('chatWindow');
const chatInput   = document.getElementById('chatInput');
const btnSend     = document.getElementById('btnSend');

// ── Auto-resize textarea ──
chatInput?.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// ── Enter to send (Shift+Enter for newline) ──
chatInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isAnalysing) sendQuery();
  }
});

// ── Quick prompt chips ──
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.q;
    if (!q || isAnalysing) return;
    chatInput.value = q;
    chatInput.dispatchEvent(new Event('input'));
    sendQuery();
  });
});

function scrollToBottom() {
  if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
}

function clearWelcome() {
  const welcome = chatWindow?.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
}

function appendMessage(role, content, isError = false) {
  if (!chatWindow) return;
  clearWelcome();

  const wrapper = document.createElement('div');
  wrapper.className = `chat-msg chat-msg--${isError ? 'error' : role}`;

  const roleLabel = document.createElement('div');
  roleLabel.className = 'chat-role';
  roleLabel.textContent = role === 'user' ? 'You' : 'AI Analyst';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = content;

  wrapper.appendChild(roleLabel);
  wrapper.appendChild(bubble);
  chatWindow.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function showAnalysing() {
  if (!chatWindow) return null;
  clearWelcome();
  const el = document.createElement('div');
  el.className = 'analysing';
  el.id = 'analysingIndicator';
  el.innerHTML = `
    <div class="dot-pulse">
      <span></span><span></span><span></span>
    </div>
    Analysing…
  `;
  chatWindow.appendChild(el);
  scrollToBottom();
  return el;
}

function removeAnalysing() {
  document.getElementById('analysingIndicator')?.remove();
}

async function sendQuery() {
  const question = chatInput?.value.trim();
  if (!question || isAnalysing) return;

  isAnalysing = true;
  btnSend.disabled = true;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  appendMessage('user', question);
  const indicator = showAnalysing();

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
    });

    removeAnalysing();

    if (res.status === 401 || res.redirected || res.url.includes('/login')) {
      appendMessage('ai', 'Session expired — please log in again.', true);
    } else if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      appendMessage('ai', `Error: ${err.error || 'Unknown error'}`, true);
    } else {
      const { answer } = await res.json();
      appendMessage('ai', answer);
      // Maintain multi-turn history (keep last 10 turns to avoid token bloat)
      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: answer });
      if (history.length > 20) history = history.slice(-20);
    }
  } catch (err) {
    removeAnalysing();
    appendMessage('ai', `Network error: ${err.message}`, true);
  } finally {
    isAnalysing = false;
    btnSend.disabled = false;
    chatInput.focus();
  }
}

// Expose sendQuery globally for the onclick in index.html
window.sendQuery = sendQuery;
