/** Runs `work` once, when the page starts to move: when the chrome's module marks it (scripts/field.js,
 *  the one owner of that choice), or, for a visitor who paused earlier, when they press Play. Never
 *  for one who asked for less motion or to save data, whose page is never marked. */
export function whenMoving(work: () => void): void {
  if (document.documentElement.dataset['motion'] === 'on') {
    work();
    return;
  }
  const look = (event: Event) => {
    if ((event as CustomEvent<{ paused: boolean }>).detail.paused) return;
    document.removeEventListener('motionchange', look);
    work();
  };
  document.addEventListener('motionchange', look);
}
