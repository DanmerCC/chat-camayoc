import { useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';

const FAVICON_SELECTOR = 'link[rel="icon"]';
const FALLBACK_BADGE_RGB = '59 130 246';

/**
 * Reads the badge colour from the live theme so the favicon dot tracks the same semantic role
 * as the sidebar indicator instead of hard-coding a palette value.
 */
const badgeColor = (): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--status-info').trim();
  return `rgb(${value || FALLBACK_BADGE_RGB})`;
};

const drawBadgedFavicon = (source: string, onReady: (dataUrl: string) => void): (() => void) => {
  const image = new Image();
  let cancelled = false;

  image.onload = () => {
    if (cancelled) {
      return;
    }
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(image, 0, 0, size, size);
    const radius = size * 0.28;
    const center = size - radius - 1;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = badgeColor();
    context.fill();
    onReady(canvas.toDataURL('image/png'));
  };

  image.src = source;
  return () => {
    cancelled = true;
  };
};

/**
 * Reflects the unseen count in the tab title and favicon.
 *
 * The title is kept under a `MutationObserver` because it has another writer: `titleHandler`
 * assigns `document.title` whenever the active conversation is renamed. Recomputing from the
 * current value, rather than from a remembered base, lets the two compose instead of clobbering
 * each other. Only the exact badge string this hook last wrote is stripped, so a conversation
 * legitimately titled "(3) Notes" keeps its prefix.
 *
 * Every declared icon is badged, not just the 32x32 one: Firefox and 1x-DPI Chrome pick the
 * 16x16 link, and a single-link badge would leave them without one.
 */
export default function useUnseenBadge(count: number) {
  const badgeEnabled = useRecoilValue(store.unseenTabBadge);
  const activeCount = badgeEnabled ? count : 0;

  useEffect(() => {
    const titleElement = document.querySelector('title');
    if (!titleElement) {
      return;
    }

    let writtenBadge = '';
    const apply = () => {
      const badge = activeCount > 0 ? `(${activeCount}) ` : '';
      const base =
        writtenBadge !== '' && document.title.startsWith(writtenBadge)
          ? document.title.slice(writtenBadge.length)
          : document.title;
      const next = `${badge}${base}`;
      if (document.title !== next) {
        document.title = next;
      }
      writtenBadge = badge;
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(titleElement, { childList: true, characterData: true, subtree: true });

    return () => {
      observer.disconnect();
      if (writtenBadge !== '' && document.title.startsWith(writtenBadge)) {
        document.title = document.title.slice(writtenBadge.length);
      }
    };
  }, [activeCount]);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>(FAVICON_SELECTOR));
    if (links.length === 0) {
      return;
    }

    /* Recorded once per link on first run; the dataset entry survives effect re-runs and
       can never capture an already-badged data URL. */
    for (const link of links) {
      link.dataset.originalHref ??= link.href;
    }
    const originals = links.map((link) => link.dataset.originalHref ?? link.href);

    if (activeCount === 0) {
      for (const [index, link] of links.entries()) {
        link.href = originals[index];
      }
      return;
    }

    const cancellations = links.map((link, index) =>
      drawBadgedFavicon(originals[index], (dataUrl) => {
        link.href = dataUrl;
      }),
    );
    return () => {
      for (const cancel of cancellations) {
        cancel();
      }
    };
  }, [activeCount]);
}
