/* query.js — AI query window */

let history = [];
let isAnalysing = false;

// ── Minimal markdown → HTML for AI chat bubbles ──
// Handles just what the assistant actually produces: **bold**, - / * bullets,
// | table | rows |, # headers, and paragraph/line breaks. Escapes HTML first
// since this renders model output via innerHTML.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineMd(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function isTableSeparatorLine(line) {
  const t = line.trim();
  return t.includes('|') && t.includes('-') && /^[\s|:-]+$/.test(t);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function renderTable(lines) {
  const header = splitTableRow(lines[0]);
  const bodyRows = lines.slice(2).map(splitTableRow);
  const thead = `<tr>${header.map(h => `<th>${inlineMd(h)}</th>`).join('')}</tr>`;
  const tbody = bodyRows
    .map(cells => `<tr>${cells.map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="chat-table-wrap"><table class="chat-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

function renderMarkdown(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let paragraphBuf = [];

  const flushParagraph = () => {
    if (paragraphBuf.length) {
      html += `<p>${paragraphBuf.map(inlineMd).join('<br>')}</p>`;
      paragraphBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Table: a row containing "|" immediately followed by a "|---|---|" separator
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      flushParagraph();
      const tableLines = [line, lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        tableLines.push(lines[j]);
        j++;
      }
      html += renderTable(tableLines);
      i = j;
      continue;
    }

    // Header: # / ## / ### etc.
    const headerMatch = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (headerMatch) {
      flushParagraph();
      html += `<div class="chat-h">${inlineMd(headerMatch[2])}</div>`;
      i++;
      continue;
    }

    // Bullet list: consecutive lines starting with - or *
    if (/^\s*[-*•]\s+(.*)$/.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const m = /^\s*[-*•]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      html += `<ul>${items.map(it => `<li>${inlineMd(it)}</li>`).join('')}</ul>`;
      continue;
    }

    // Blank line ends the current paragraph
    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }

    paragraphBuf.push(line);
    i++;
  }
  flushParagraph();
  return html;
}

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
  if (role === 'ai' && !isError) {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }

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
