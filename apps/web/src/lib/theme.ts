/** The theme toggle's three states and the name each gives the toggle. A press cycles System, the
 *  theme the OS is not showing, then the one it is (src/scripts/theme.js holds the order). The
 *  command menu's theme entry shows the same names, so the two always match (design-system.md,
 *  "One nav manifest"). */
export const THEME_STATES = [
  { theme: 'system', name: 'Theme: system' },
  { theme: 'light', name: 'Theme: light' },
  { theme: 'dark', name: 'Theme: dark' },
] as const;
