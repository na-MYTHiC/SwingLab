/** Shared formatting so numbers read the same everywhere in the app. */

export function num(value: number, dp = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(dp);
}

export function signedNum(value: number, dp = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(dp));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(dp)}`;
}

export function shots(value: number): string {
  return value < 0.1 ? '<0.1' : value.toFixed(1);
}

export function minutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function shortDate(date: Date | null): string {
  if (!date) return 'Undated';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function speedLabel(speed: 'immediate' | 'weeks' | 'months'): string {
  switch (speed) {
    case 'immediate':
      return 'Pays off now';
    case 'weeks':
      return 'Weeks';
    case 'months':
      return 'Months';
  }
}
