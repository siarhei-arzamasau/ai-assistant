// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Transcript } from '../../src/client/components/Transcript';
import type { Store } from '../../src/client/useChat';
import type { DisplayItem } from '../../src/client/types';

const storeWith = (transcript: DisplayItem[]) => ({ transcript } as unknown as Store);

describe('Transcript', () => {
  it('shows the welcome screen when the transcript is empty', () => {
    const { getByText } = render(<Transcript s={storeWith([])} />);
    expect(getByText('How can I help you today?')).toBeInTheDocument();
  });

  it('renders a user message as plain text (no HTML injection)', () => {
    const { container } = render(
      <Transcript s={storeWith([{ kind: 'message', id: '1', role: 'user', content: 'hello <b>x</b>' }])} />,
    );
    const bubble = container.querySelector('.bubble-user')!;
    expect(bubble.textContent).toBe('hello <b>x</b>');
    expect(bubble.querySelector('b')).toBeNull();
  });

  it('renders assistant markdown as HTML', () => {
    const { container } = render(
      <Transcript s={storeWith([{ kind: 'message', id: '1', role: 'assistant', content: '**bold**' }])} />,
    );
    const strong = container.querySelector('.bubble-assistant strong');
    expect(strong?.textContent).toBe('bold');
  });

  it('renders a system note with its alignment / mono modifiers', () => {
    const { container } = render(
      <Transcript s={storeWith([{ kind: 'system', id: '1', text: 'a note', align: 'left', mono: true }])} />,
    );
    const sys = container.querySelector('.bubble-system')!;
    expect(sys.textContent).toBe('a note');
    expect(sys).toHaveClass('align-left');
    expect(sys).toHaveClass('mono');
  });

  it('shows the streaming bubble, then the interrupted tag when stopped', () => {
    const { container, rerender } = render(
      <Transcript s={storeWith([{ kind: 'message', id: '1', role: 'assistant', content: 'partial', streaming: true }])} />,
    );
    expect(container.querySelector('.bubble-assistant.streaming')).not.toBeNull();

    rerender(
      <Transcript s={storeWith([{ kind: 'message', id: '1', role: 'assistant', content: 'partial', interrupted: true }])} />,
    );
    expect(container.querySelector('.bubble-assistant.streaming')).toBeNull();
    expect(container.querySelector('.bubble-interrupted-tag')?.textContent).toBe('Stopped');
  });

  it('labels an interrupt with no content distinctly', () => {
    const { container } = render(
      <Transcript s={storeWith([{ kind: 'message', id: '1', role: 'assistant', content: '', interrupted: true }])} />,
    );
    expect(container.querySelector('.bubble-interrupted-tag')?.textContent).toBe('Stopped before any response');
  });
});
