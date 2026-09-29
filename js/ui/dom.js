// Tiny DOM helpers.

/**
 * Create an element. `attrs` keys: class, text, html, on* handlers, dataset via data-*, others as attributes.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {...(Node|string|null|false|undefined)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** A button with at least a 44px touch target (via CSS class .btn). */
export function button(text, onClick, { variant = '', disabled = false, title } = {}) {
  return h('button', { type: 'button', class: `btn ${variant}`.trim(), onclick: onClick, disabled, title }, text);
}

/** Replace an element's children. */
export function mount(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}
