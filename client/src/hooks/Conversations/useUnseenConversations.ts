import { useState, useEffect, useCallback } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import type { ConversationCursorData } from '~/utils/convos';
import { isConversationUnseen } from '~/utils';

export type UnseenConversation = {
  conversationId: string;
  title: string;
};

const readUnseen = (queryClient: QueryClient): UnseenConversation[] => {
  const queries = queryClient
    .getQueryCache()
    .findAll([QueryKeys.allConversations], { exact: false });

  const seenIds = new Set<string>();
  const unseen: UnseenConversation[] = [];

  for (const query of queries) {
    const data = queryClient.getQueryData<InfiniteData<ConversationCursorData>>(query.queryKey);
    if (!data) {
      continue;
    }
    for (const page of data.pages) {
      for (const convo of page.conversations) {
        const { conversationId } = convo;
        if (!conversationId || seenIds.has(conversationId)) {
          continue;
        }
        seenIds.add(conversationId);
        if (isConversationUnseen(convo)) {
          unseen.push({ conversationId, title: convo.title ?? '' });
        }
      }
    }
  }

  return unseen;
};

const identityOf = (unseen: UnseenConversation[]): string =>
  unseen
    .map((c) => c.conversationId)
    .sort()
    .join(',');

/**
 * The set of conversations that have replied since the user last caught up with them.
 *
 * Derived from the conversation list already in cache, so it costs no request of its own and
 * needs no count endpoint. Unseen conversations are recent by definition and the list sorts by
 * `updatedAt` descending, so they sit on the first page.
 *
 * Subscribing to the query cache (rather than mounting a second list query) avoids duplicating
 * the sidebar's fetch. Cache events are filtered by key before any recomputation, because they
 * also fire for message updates on every streamed token.
 */
export default function useUnseenConversations(): UnseenConversation[] {
  const queryClient = useQueryClient();
  const [unseen, setUnseen] = useState<UnseenConversation[]>(() => readUnseen(queryClient));

  const refresh = useCallback(() => {
    const next = readUnseen(queryClient);
    setUnseen((current) => (identityOf(current) === identityOf(next) ? current : next));
  }, [queryClient]);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.query?.queryKey?.[0] !== QueryKeys.allConversations) {
        return;
      }
      refresh();
    });
    refresh();
    return unsubscribe;
  }, [queryClient, refresh]);

  return unseen;
}
