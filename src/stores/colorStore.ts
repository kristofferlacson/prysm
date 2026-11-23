import { create } from 'zustand';

/** Colours the user picked recently, newest first. Shared by every colour control and kept between visits. */
const KEY = 'prysm.recentColors';
const MAX = 14;

function load(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export const useRecentColors = create<{ colors: string[] }>(() => ({ colors: load() }));

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Remembers a colour once the user has settled on it. Dragging through a colour picker reports
 * dozens of values; only the one still current after a short pause is kept.
 */
export function rememberColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const c = color.toLowerCase();
    const colors = [c, ...useRecentColors.getState().colors.filter((x) => x !== c)].slice(0, MAX);
    useRecentColors.setState({ colors });
    try {
      localStorage.setItem(KEY, JSON.stringify(colors));
    } catch {
      // Private browsing: kept for this visit only.
    }
  }, 450);
}
