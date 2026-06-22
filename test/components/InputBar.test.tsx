// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputBar } from '../../src/client/components/InputBar';
import type { Store, ChatActions } from '../../src/client/useChat';

const baseStore = (over: Partial<Store> = {}) =>
  ({ streaming: false, lastInputTokens: 0, sessionOutputTokens: 0, ...over } as unknown as Store);

const actionsStub = (over: Partial<ChatActions> = {}) =>
  ({ send: vi.fn(), stopStreaming: vi.fn(), ...over } as unknown as ChatActions);

describe('InputBar', () => {
  it('enables Send once there is text, then sends on Enter and clears the field', async () => {
    const user = userEvent.setup();
    const a = actionsStub();
    render(<InputBar s={baseStore()} a={a} />);

    const button = screen.getByRole('button', { name: 'Send' });
    const ta = screen.getByPlaceholderText('Message Claude…') as HTMLTextAreaElement;
    expect(button).toBeDisabled();

    await user.type(ta, 'hello there');
    expect(button).toBeEnabled();

    await user.keyboard('{Enter}');
    expect(a.send).toHaveBeenCalledWith('hello there');
    expect(ta.value).toBe('');
  });

  it('does not send a whitespace-only message', async () => {
    const user = userEvent.setup();
    const a = actionsStub();
    render(<InputBar s={baseStore()} a={a} />);
    await user.type(screen.getByPlaceholderText('Message Claude…'), '   ');
    await user.keyboard('{Enter}');
    expect(a.send).not.toHaveBeenCalled();
  });

  it('acts as a Stop button while streaming', async () => {
    const user = userEvent.setup();
    const a = actionsStub();
    render(<InputBar s={baseStore({ streaming: true })} a={a} />);

    const button = screen.getByRole('button', { name: 'Stop' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(a.stopStreaming).toHaveBeenCalledTimes(1);
    expect(a.send).not.toHaveBeenCalled();
  });

  it('shows session token stats when present', () => {
    render(<InputBar s={baseStore({ lastInputTokens: 1200, sessionOutputTokens: 345 })} a={actionsStub()} />);
    expect(screen.getByText(/Session: 345 out total · 1,200 ctx/)).toBeInTheDocument();
  });
});
