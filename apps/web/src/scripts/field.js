// The field's current (styles/field.css) shows while the page scrolls and fades as it stops, so no
// line stands across the words someone is reading. Only the start and the stop touch the page.
const field = document.querySelector('.field');
if (field instanceof HTMLElement) {
  let timer = 0;
  addEventListener(
    'scroll',
    () => {
      if (!timer) field.dataset['moving'] = '';
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        delete field.dataset['moving'];
      }, 140);
    },
    { passive: true },
  );
}
