import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { MutableSnapshot } from 'recoil';
import useReplyAlerts, { requestReplyNotificationPermission } from '../useReplyAlerts';
import store from '~/store';
import type { UnseenConversation } from '../useUnseenConversations';

/* The hooks barrel is circular with ~/data-provider; mocking it wholesale keeps the
   suite off that cycle while still exercising the hook's real diff/notify logic. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const permissionRequest = jest.fn();

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = permissionRequest;
  onclick: (() => void) | null = null;
  close = jest.fn();

  constructor(
    public title: string,
    public options?: { body?: string; tag?: string },
  ) {
    createdNotifications.push(this);
  }
}

const createdNotifications: FakeNotification[] = [];

const createOscillator = jest.fn();
const createGain = jest.fn();

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = jest.fn();
  createOscillator = createOscillator;
  createGain = createGain;
}

function stubOscillator() {
  createOscillator.mockImplementation(() => ({
    type: '',
    frequency: { value: 0 },
    connect: jest.fn(() => ({ connect: jest.fn() })),
    start: jest.fn(),
    stop: jest.fn(),
  }));
  createGain.mockImplementation(() => ({
    gain: {
      setValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
  }));
}

type Toggles = { notifications?: boolean; sound?: boolean };

function setup(toggles: Toggles = {}, initialUnseen: UnseenConversation[] = []) {
  const { notifications = false, sound = false } = toggles;
  const pathnameRef = { current: '/' };

  const Probe = () => {
    const location = useLocation();
    pathnameRef.current = location.pathname;
    return null;
  };

  const initialize = (snapshot: MutableSnapshot) => {
    snapshot.set(store.replyNotifications, notifications);
    snapshot.set(store.replyNotificationSound, sound);
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot initializeState={initialize}>
      <MemoryRouter initialEntries={['/']}>
        {children}
        <Probe />
      </MemoryRouter>
    </RecoilRoot>
  );

  return {
    ...renderHook((unseen: UnseenConversation[]) => useReplyAlerts(unseen), {
      initialProps: initialUnseen,
      wrapper,
    }),
    pathnameRef,
  };
}

describe('useReplyAlerts', () => {
  let hasFocus: jest.SpyInstance;

  beforeEach(() => {
    createdNotifications.length = 0;
    permissionRequest.mockReset();
    createOscillator.mockReset();
    createGain.mockReset();
    stubOscillator();
    FakeNotification.permission = 'granted';
    /* jsdom ships neither API; the narrowest honest stand-ins are constructor shims. */
    window.Notification = FakeNotification as unknown as typeof Notification;
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    hasFocus = jest.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    hasFocus.mockRestore();
    Reflect.deleteProperty(window, 'Notification');
    Reflect.deleteProperty(window, 'AudioContext');
  });

  describe('requestReplyNotificationPermission', () => {
    it('asks the browser while permission is still the default', () => {
      FakeNotification.permission = 'default';

      requestReplyNotificationPermission();

      expect(permissionRequest).toHaveBeenCalledTimes(1);
    });

    it('asks nothing once permission is granted or denied', () => {
      FakeNotification.permission = 'granted';
      requestReplyNotificationPermission();
      FakeNotification.permission = 'denied';
      requestReplyNotificationPermission();

      expect(permissionRequest).not.toHaveBeenCalled();
    });

    it('is a no-op where the Notification API is absent', () => {
      Reflect.deleteProperty(window, 'Notification');

      expect(() => requestReplyNotificationPermission()).not.toThrow();
    });
  });

  it('does not fire a burst for a backlog that predates the session', () => {
    /* Signing in with unread conversations: the first pass only records them. */
    setup({ notifications: true }, [{ conversationId: 'convo-backlog', title: 'Backlog' }]);

    expect(createdNotifications).toHaveLength(0);
  });

  it('notifies for arrivals while the user is away', async () => {
    const { rerender } = setup({ notifications: true });

    act(() => {
      rerender([{ conversationId: 'convo-b', title: 'Beta' }]);
    });

    await waitFor(() => expect(createdNotifications).toHaveLength(1));
    expect(createdNotifications[0].title).toBe('com_ui_reply_ready');
    expect(createdNotifications[0].options?.body).toBe('Beta');
    expect(createdNotifications[0].options?.tag).toBe('convo-b');
  });

  it('falls back to the untitled label when the conversation has no title', async () => {
    const { rerender } = setup({ notifications: true });

    act(() => {
      rerender([{ conversationId: 'convo-c', title: '' }]);
    });

    await waitFor(() => expect(createdNotifications).toHaveLength(1));
    expect(createdNotifications[0].options?.body).toBe('com_ui_untitled');
  });

  it('stays quiet while the user is looking at the app', () => {
    hasFocus.mockReturnValue(true);
    const { rerender } = setup({ notifications: true });

    act(() => {
      rerender([{ conversationId: 'convo-b', title: 'Beta' }]);
    });

    expect(createdNotifications).toHaveLength(0);
  });

  it('plays the chime for sound-only users without desktop notifications', () => {
    const { rerender } = setup({ sound: true });

    act(() => {
      rerender([{ conversationId: 'convo-b', title: 'Beta' }]);
    });

    expect(createdNotifications).toHaveLength(0);
    expect(createOscillator).toHaveBeenCalledTimes(2);
  });

  it('navigates to the conversation when the notification is clicked', async () => {
    const windowFocus = jest.spyOn(window, 'focus').mockImplementation(() => undefined);
    const { rerender, pathnameRef } = setup({ notifications: true });

    act(() => {
      rerender([{ conversationId: 'convo-b', title: 'Beta' }]);
    });
    await waitFor(() => expect(createdNotifications).toHaveLength(1));

    act(() => {
      createdNotifications[0].onclick?.();
    });

    await waitFor(() => expect(pathnameRef.current).toBe('/c/convo-b'));
    expect(windowFocus).toHaveBeenCalled();
    expect(createdNotifications[0].close).toHaveBeenCalled();
    windowFocus.mockRestore();
  });
});
