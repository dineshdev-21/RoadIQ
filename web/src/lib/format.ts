export const STATUSES = ['New', 'Under Review', 'Dispatched', 'In Repair', 'Resolved'] as const;

export const STATUS_LABELS: Record<string, string> = {
  New: 'New incident',
  'Under Review': 'Under review',
  Dispatched: 'Dispatched to PWD crew',
  'In Repair': 'In repair (asphalt filling)',
  Resolved: 'Resolved, closed',
};

export const CLASSES = ['Pothole', 'Manhole Cover', 'Speed Bump', 'Rough Patch'] as const;

export const WARDS: [string, string][] = [
  ['Ward 1', 'Ward 1, LPU University Zone'],
  ['Ward 2', 'Ward 2, Law Gate Sub-District'],
  ['Ward 3', 'Ward 3, Chaheru Crossing'],
  ['Ward 4', 'Ward 4, GT Road NH-44'],
  ['Ward 5', 'Ward 5, Phagwara Bypass'],
  ['Ward 6', 'Ward 6, Hardaspur PWD'],
  ['Ward 7', 'Ward 7, Jalandhar Cantt'],
];

/** PWD action window per severity score, as the README's triage table sets it. */
export const SEVERITY_WINDOW: Record<number, string> = {
  5: 'Same day',
  4: 'Within 48 h',
  3: 'Within 72 h',
  2: 'Within 7 days',
  1: 'Routine cycle',
};

export const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** "Ward 4 - GT Road NH-44" reads "Ward 4, GT Road NH-44" in running text. */
export const wardLabel = (ward: string) => ward.replace(' - ', ', ');

export const num = (v: number | undefined, digits = 1) => (v == null ? '–' : v.toFixed(digits));
