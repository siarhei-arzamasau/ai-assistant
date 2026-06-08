interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Settings {
  maxTokens: number;
  temperature: number;
  stopSequences: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdown(raw: string): string {
  let s = escapeHtml(raw);

  // Fenced code blocks
  s = s.replace(
    /```(?:\w+)?\n?([\s\S]*?)```/g,
    (_, code) => `<pre><code>${code.trimEnd()}</code></pre>`,
  );

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Newlines outside pre blocks
  const segments = s.split(/(<pre>[\s\S]*?<\/pre>)/g);
  s = segments
    .map((seg, i) => (i % 2 === 0 ? seg.replace(/\n/g, '<br>') : seg))
    .join('');

  return s;
}

class Chat {
  private history: Message[] = [];
  private streaming = false;

  private messagesEl = document.getElementById('messages') as HTMLDivElement;
  private welcomeEl = document.getElementById('welcome') as HTMLDivElement;
  private inputEl = document.getElementById('userInput') as HTMLTextAreaElement;
  private sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  private clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

  private settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
  private settingsPanel = document.getElementById('settingsPanel') as HTMLDivElement;
  private maxTokensEl = document.getElementById('maxTokens') as HTMLInputElement;
  private maxTokensValEl = document.getElementById('maxTokensVal') as HTMLSpanElement;
  private temperatureEl = document.getElementById('temperature') as HTMLInputElement;
  private tempValEl = document.getElementById('tempVal') as HTMLSpanElement;
  private stopSeqsEl = document.getElementById('stopSeqs') as HTMLInputElement;

  constructor() {
    this.sendBtn.addEventListener('click', () => this.send());
    this.clearBtn.addEventListener('click', () => this.clear());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.sendBtn.disabled) this.send();
      }
    });

    this.inputEl.addEventListener('input', () => {
      this.autoResize();
      this.syncSendBtn();
    });

    this.settingsBtn.addEventListener('click', () => this.toggleSettings());

    this.maxTokensEl.addEventListener('input', () => {
      this.maxTokensValEl.textContent = this.maxTokensEl.value;
    });

    this.temperatureEl.addEventListener('input', () => {
      this.tempValEl.textContent = parseFloat(this.temperatureEl.value).toFixed(2);
    });

  }

  private toggleSettings() {
    const open = this.settingsPanel.classList.toggle('open');
    this.settingsBtn.classList.toggle('active', open);
    this.settingsBtn.setAttribute('aria-expanded', String(open));
  }

  private getSettings(): Settings {
    return {
      maxTokens: parseInt(this.maxTokensEl.value, 10),
      temperature: parseFloat(this.temperatureEl.value),
      stopSequences: this.stopSeqsEl.value
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0),
    };
  }

  private autoResize() {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
  }

  private syncSendBtn() {
    this.sendBtn.disabled = this.streaming || !this.inputEl.value.trim();
  }

  private setStreaming(on: boolean) {
    this.streaming = on;
    this.inputEl.disabled = on;
    this.syncSendBtn();
  }

  private clear() {
    this.history = [];
    this.messagesEl.innerHTML = '';
    this.welcomeEl = document.createElement('div');
    this.welcomeEl.id = 'welcome';
    this.welcomeEl.className = 'welcome';
    this.welcomeEl.innerHTML = `
      <div class="welcome-glyph">&#9670;</div>
      <h1>How can I help you today?</h1>
      <p>Powered by Claude Opus 4 via the Anthropic API</p>
    `;
    this.messagesEl.appendChild(this.welcomeEl);
  }

  private hideWelcome() {
    this.welcomeEl?.remove();
  }

  private addBubble(role: 'user' | 'assistant'): HTMLElement {
    this.hideWelcome();

    const row = document.createElement('div');
    row.className = `message message-${role}`;

    if (role === 'assistant') {
      row.innerHTML = `
        <div class="avatar avatar-assistant">&#9670;</div>
        <div class="bubble bubble-assistant"></div>
      `;
    } else {
      row.innerHTML = `<div class="bubble bubble-user"></div>`;
    }

    this.messagesEl.appendChild(row);
    this.scrollBottom();
    return row.querySelector('.bubble') as HTMLElement;
  }

  private scrollBottom() {
    const main = document.querySelector('.main') as HTMLElement;
    main.scrollTop = main.scrollHeight;
  }

  private async send() {
    const text = this.inputEl.value.trim();
    if (!text || this.streaming) return;

    this.history.push({ role: 'user', content: text });
    const userBubble = this.addBubble('user');
    userBubble.textContent = text;

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.setStreaming(true);

    const assistantBubble = this.addBubble('assistant');
    assistantBubble.classList.add('streaming');

    let accumulated = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.history, settings: this.getSettings() }),
      });

      if (!res.ok) {
        throw new Error(`Server error ${res.status}: ${await res.text()}`);
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;

          let parsed: { text?: string; error?: string; thinking?: boolean };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          if (parsed.error) throw new Error(parsed.error);

          if (parsed.thinking === true && !accumulated) {
            assistantBubble.setAttribute('data-thinking', '1');
          }
          if (parsed.thinking === false) {
            assistantBubble.removeAttribute('data-thinking');
          }

          if (parsed.text) {
            assistantBubble.removeAttribute('data-thinking');
            accumulated += parsed.text;
            assistantBubble.textContent = accumulated;
            this.scrollBottom();
          }
        }
      }

      this.history.push({ role: 'assistant', content: accumulated });
      assistantBubble.innerHTML = renderMarkdown(accumulated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      assistantBubble.textContent = msg;
      assistantBubble.classList.add('error');
      this.history.pop(); // remove user message that failed
    } finally {
      assistantBubble.classList.remove('streaming');
      this.setStreaming(false);
      this.inputEl.focus();
    }
  }
}

new Chat();
