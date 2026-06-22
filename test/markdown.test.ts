import { describe, it, expect } from 'vitest';
import { escapeHtml, renderMarkdown } from '../src/client/markdown';

describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href="x"&gt;&amp;');
  });

  it('escapes & before < and > (no double-escaping)', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});

describe('renderMarkdown', () => {
  it('renders bold and italic', () => {
    expect(renderMarkdown('**bold** and *italic*')).toBe('<strong>bold</strong> and <em>italic</em>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('use `npm test`')).toBe('use <code>npm test</code>');
  });

  it('renders a fenced code block and preserves its content', () => {
    const out = renderMarkdown('```ts\nconst x = 1;\n```');
    expect(out).toBe('<pre><code>const x = 1;</code></pre>');
  });

  it('converts newlines outside code blocks to <br>', () => {
    expect(renderMarkdown('line1\nline2')).toBe('line1<br>line2');
  });

  it('does NOT convert newlines inside a code block', () => {
    const out = renderMarkdown('```\na\nb\n```');
    expect(out).toBe('<pre><code>a\nb</code></pre>');
    expect(out).not.toContain('<br>');
  });

  it('escapes HTML in the source before formatting', () => {
    expect(renderMarkdown('<script>')).toBe('&lt;script&gt;');
  });
});
