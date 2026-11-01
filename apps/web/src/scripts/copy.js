// The address's copy button (Home's Contact): a mailto link opens nothing on a computer with no mail
// app set up, so the address can also be copied in one press. The button says what happened, in a
// live region, and keeps its width (home.css sizes it to its longest words), so nothing moves. When
// the clipboard refuses, the address is selected instead, ready for the visitor's own copy.

const SAID = 2400;

for (const button of document.querySelectorAll('[data-copy-address]')) {
  const label = button.querySelector('.copy-label');
  const at = label?.textContent ?? '';
  let timer = 0;
  /** @param {string} words */
  const say = (words) => {
    if (!label) return;
    label.textContent = words;
    clearTimeout(timer);
    timer = setTimeout(() => (label.textContent = at), SAID);
  };
  button.addEventListener('click', () => {
    const address = button.getAttribute('data-copy-address') ?? '';
    const select = () => {
      const shown = document.querySelector('.contact-address');
      const selection = getSelection();
      if (!shown || !selection) return say('Copy it from above');
      const range = document.createRange();
      range.selectNodeContents(shown);
      selection.removeAllRanges();
      selection.addRange(range);
      say('Selected above');
    };
    if (!navigator.clipboard) return select();
    navigator.clipboard.writeText(address).then(() => say('Copied'), select);
  });
}
