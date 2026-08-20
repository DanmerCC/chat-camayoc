import { useRef, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useNavigate } from 'react-router-dom';
import type { UnseenConversation } from './useUnseenConversations';
import { useLocalize } from '~/hooks';
import store from '~/store';

let sharedContext: AudioContext | null = null;

/**
 * Synthesized rather than shipped as an asset: two short tones need no binary, no request, and
 * no cache entry. Failure is always silent, because a missed chime is not worth an error toast.
 */
const playChime = () => {
  try {
    if (typeof window.AudioContext !== 'function') {
      return;
    }
    sharedContext = sharedContext ?? new AudioContext();
    if (sharedContext.state === 'suspended') {
      void sharedContext.resume();
    }
    const start = sharedContext.currentTime;
    const tones: Array<[number, number]> = [
      [880, 0],
      [1174.66, 0.12],
    ];

    for (const [frequency, offset] of tones) {
      const oscillator = sharedContext.createOscillator();
      const gain = sharedContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.25);
      oscillator.connect(gain).connect(sharedContext.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.3);
    }
  } catch {
    /* Autoplay policy or an unavailable output device. */
  }
};

const canNotify = (): boolean => 'Notification' in window && Notification.permission === 'granted';

/**
 * Requests desktop-notification permission on behalf of the settings toggle.
 *
 * Must be called from the toggle's change handler: that is the user gesture browsers require.
 * An effect on the persisted toggle fires on load without one, and Chrome answers gestureless
 * requests by denying them, which locks the origin out of notifications until the user digs
 * into site settings.
 */
export const requestReplyNotificationPermission = (): void => {
  if (!('Notification' in window) || Notification.permission !== 'default') {
    return;
  }
  void Notification.requestPermission();
};

/**
 * Announces replies that landed while the user was away.
 *
 * Alerts are suppressed whenever the document has focus: the sidebar dot already covers the case
 * where the user is looking at the app, and interrupting them there would be noise. The first
 * pass only records what is already unseen, so signing in with a backlog does not fire a burst.
 */
export default function useReplyAlerts(unseen: UnseenConversation[]) {
  const notificationsEnabled = useRecoilValue(store.replyNotifications);
  const soundEnabled = useRecoilValue(store.replyNotificationSound);
  const localize = useLocalize();
  const navigate = useNavigate();
  const knownRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const known = knownRef.current;
    knownRef.current = new Set(unseen.map((conversation) => conversation.conversationId));

    if (known === null) {
      return;
    }

    const arrivals = unseen.filter(
      (conversation) => !known.has(conversation.conversationId) && conversation.conversationId,
    );
    if (arrivals.length === 0 || document.hasFocus()) {
      return;
    }

    if (soundEnabled) {
      playChime();
    }

    if (!notificationsEnabled || !canNotify()) {
      return;
    }

    for (const conversation of arrivals) {
      const notification = new Notification(localize('com_ui_reply_ready'), {
        body: conversation.title || localize('com_ui_untitled'),
        tag: conversation.conversationId,
      });
      notification.onclick = () => {
        window.focus();
        navigate(`/c/${conversation.conversationId}`);
        notification.close();
      };
    }
  }, [unseen, soundEnabled, notificationsEnabled, localize, navigate]);
}
