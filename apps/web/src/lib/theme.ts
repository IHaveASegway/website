/** The theme toggle's three states and the name each gives the toggle, in the panel's words: Day,
 *  Night, or System, which follows the OS (ADR 0025). A press cycles System, the theme the OS is not
 *  showing, then the one it is (src/scripts/theme.js holds the order). The command menu's theme
 *  entry shows the same names, so the two always match (design-system.md, "One nav manifest"). */
export const THEME_STATES = [
  { theme: 'system', name: 'Theme: System' },
  { theme: 'light', name: 'Theme: Day' },
  { theme: 'dark', name: 'Theme: Night' },
] as const;
