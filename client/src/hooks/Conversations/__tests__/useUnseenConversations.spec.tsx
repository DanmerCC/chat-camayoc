import React from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import useUnseenConversations from '../useUnseenConversations';

const listKeyActive = [QueryKeys.allConversations, { isArchived: false }];
const listKeyArchived = [QueryKeys.allConversations, { isArchived: true }];

const RESPONDED_AT = '2026-08-16T10:00:00.000Z';
const SEEN_AFTER = '2026-08-16T11:00:00.000Z';

function page(conversations: unknown[]) {
  return { pages: [{ conversations, nextCursor: null }], pageParams: [null] };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useUnseenConversations(), { wrapper }), queryClient };
}

describe('useUnseenConversations', () => {
  it('derives the unseen set from the cached lists', () => {
    const { result, queryClient } = setup();

    act(() => {
      queryClient.setQueryData(
        listKeyActive,
        page([
          { conversationId: 'unseen-a', title: 'A', lastResponseAt: RESPONDED_AT },
          {
            conversationId: 'seen-a',
            title: 'S',
            lastResponseAt: RESPONDED_AT,
            lastSeenAt: SEEN_AFTER,
          },
          { conversationId: 'never-replied', title: 'N' },
        ]),
      );
    });

    expect(result.current).toEqual([{ conversationId: 'unseen-a', title: 'A' }]);
  });

  it('dedupes a conversation cached in more than one list query', () => {
    const { result, queryClient } = setup();
    const convo = { conversationId: 'dup', title: 'D', lastResponseAt: RESPONDED_AT };

    act(() => {
      queryClient.setQueryData(listKeyActive, page([convo]));
      queryClient.setQueryData(listKeyArchived, page([convo]));
    });

    expect(result.current).toEqual([{ conversationId: 'dup', title: 'D' }]);
  });

  it('ignores cache events outside the conversation lists', () => {
    const { result, queryClient } = setup();

    act(() => {
      queryClient.setQueryData(
        [QueryKeys.messages, 'm1'],
        page([{ conversationId: 'not-a-list-row', title: 'M', lastResponseAt: RESPONDED_AT }]),
      );
    });

    expect(result.current).toEqual([]);
  });

  it('keeps the array identity when the unseen set is unchanged', () => {
    const { result, queryClient } = setup();

    act(() => {
      queryClient.setQueryData(
        listKeyActive,
        page([{ conversationId: 'unseen-a', title: 'A', lastResponseAt: RESPONDED_AT }]),
      );
    });
    const before = result.current;

    act(() => {
      queryClient.setQueryData(
        listKeyActive,
        page([{ conversationId: 'unseen-a', title: 'A', lastResponseAt: RESPONDED_AT }]),
      );
    });

    expect(result.current).toBe(before);
  });
});
