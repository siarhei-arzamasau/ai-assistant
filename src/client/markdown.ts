export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderMarkdown(raw: string): string {
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
