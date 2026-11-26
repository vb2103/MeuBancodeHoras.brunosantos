/**
 * Primitivas leves de transição, erros inline e micro-interações CSS-first.
 * Baseado em transitions-dev sem dependências externas.
 */

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readCssMs(varName, fallbackMs = 150) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallbackMs;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallbackMs;
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return fallbackMs;
  return raw.endsWith('s') && !raw.endsWith('ms') ? num * 1000 : num;
}

export function renderLucideIcons(root = null) {
  const api = globalThis.window?.lucide;
  if (!api || typeof api.createIcons !== 'function') return;
  if (root && api.icons) {
    api.createIcons({ icons: api.icons, root });
  } else {
    api.createIcons();
  }
}

export function isLayerOpen(el) {
  return Boolean(el && !el.classList.contains('hidden') && !el.classList.contains('is-closing'));
}

export function openAnimatedModal(el) {
  if (!el) return;
  if (el._shCloseTimer) {
    clearTimeout(el._shCloseTimer);
    el._shCloseTimer = null;
  }
  el.classList.remove('hidden', 'is-closing');
  if (prefersReducedMotion()) {
    el.classList.add('is-open');
    return;
  }
  el.classList.remove('is-open');
  void el.offsetWidth;
  el.classList.add('is-open');
}

export function closeAnimatedModal(el, onHidden = null) {
  if (!el || el.classList.contains('hidden')) {
    if (typeof onHidden === 'function') onHidden();
    return;
  }
  if (el._shCloseTimer) {
    clearTimeout(el._shCloseTimer);
    el._shCloseTimer = null;
  }

  el.classList.remove('is-open');
  if (prefersReducedMotion()) {
    el.classList.remove('is-closing');
    el.classList.add('hidden');
    if (typeof onHidden === 'function') onHidden();
    return;
  }

  el.classList.add('is-closing');
  const closeMs = readCssMs('--modal-close-dur', 150) + 16;
  el._shCloseTimer = setTimeout(() => {
    el._shCloseTimer = null;
    if (el.classList.contains('is-closing')) {
      el.classList.remove('is-closing');
      el.classList.add('hidden');
    }
    if (typeof onHidden === 'function') onHidden();
  }, closeMs);
}

export function openAnimatedDropdown(el) {
  if (!el) return;
  if (el._shCloseTimer) {
    clearTimeout(el._shCloseTimer);
    el._shCloseTimer = null;
  }
  el.classList.remove('hidden', 'is-closing');
  if (prefersReducedMotion()) {
    el.classList.add('is-open');
    return;
  }
  el.classList.remove('is-open');
  void el.offsetWidth;
  el.classList.add('is-open');
}

export function closeAnimatedDropdown(el) {
  if (!el || el.classList.contains('hidden')) return;
  if (el._shCloseTimer) {
    clearTimeout(el._shCloseTimer);
    el._shCloseTimer = null;
  }

  el.classList.remove('is-open');
  if (prefersReducedMotion()) {
    el.classList.remove('is-closing');
    el.classList.add('hidden');
    return;
  }

  el.classList.add('is-closing');
  const closeMs = readCssMs('--dropdown-close-dur', 150) + 16;
  el._shCloseTimer = setTimeout(() => {
    el._shCloseTimer = null;
    if (el.classList.contains('is-closing')) {
      el.classList.remove('is-closing');
      el.classList.add('hidden');
    }
  }, closeMs);
}

export function setAccordionOpen(accOrId, isOpen) {
  const acc = typeof accOrId === 'string' ? document.getElementById(accOrId) : accOrId;
  if (!acc) return;
  const openStr = String(Boolean(isOpen));
  acc.setAttribute('data-open', openStr);
  const head = acc.querySelector('.t-acc-head');
  if (head) head.setAttribute('aria-expanded', openStr);
}

export function initAccordions(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.t-acc').forEach((acc) => {
    const head = acc.querySelector('.t-acc-head');
    if (!head || head.dataset.accBound === '1') return;
    head.dataset.accBound = '1';
    head.addEventListener('click', () => {
      const currentOpen = acc.getAttribute('data-open') === 'true';
      setAccordionOpen(acc, !currentOpen);
    });
  });
}

export function syncSlidingTabs(barEl, activeTabEl, { animate = true } = {}) {
  if (!barEl || !activeTabEl) return;
  const pill = barEl.querySelector('.t-tabs-pill, .t-tabs-underline');
  if (!pill) return;

  const isUnderline = pill.classList.contains('t-tabs-underline');
  const left = activeTabEl.offsetLeft;
  const width = activeTabEl.offsetWidth;
  if (!width) return;

  if (!animate || prefersReducedMotion()) {
    pill.style.transition = 'none';
  }
  pill.style.transform = `translateX(${left}px)`;
  pill.style.width = `${width}px`;
  if (!isUnderline) {
    pill.style.height = `${activeTabEl.offsetHeight}px`;
    pill.style.top = `${activeTabEl.offsetTop}px`;
  }
  if (!animate || prefersReducedMotion()) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}

export function initSlidingTabsGroup(barEl, selector, activeFinder, { animate = false } = {}) {
  if (!barEl || typeof activeFinder !== 'function') return;
  const active = activeFinder(barEl);
  if (active) syncSlidingTabs(barEl, active, { animate });

  if (typeof window !== 'undefined' && !barEl._shTabResizeBound) {
    barEl._shTabResizeBound = true;
    window.addEventListener('resize', () => {
      const currentActive = activeFinder(barEl);
      if (currentActive) syncSlidingTabs(barEl, currentActive, { animate: false });
    });
  }
}

export function clearInlineFieldError(wrapOrId) {
  const wrap = typeof wrapOrId === 'string' ? document.getElementById(wrapOrId) : wrapOrId;
  if (!wrap) return;
  if (wrap._revertTimer) {
    clearTimeout(wrap._revertTimer);
    wrap._revertTimer = null;
  }
  wrap.classList.remove('is-error');
  wrap.querySelectorAll('.t-input').forEach((inp) => {
    inp.classList.remove('is-error', 'is-shaking');
    inp.removeAttribute('aria-invalid');
  });
  const msgEl = wrap.querySelector('.t-error-msg');
  if (msgEl) msgEl.textContent = '';
}

export function clearAllInlineErrors(container = document) {
  if (!container?.querySelectorAll) return;
  container.querySelectorAll('.t-input-wrap.is-error').forEach((wrap) => clearInlineFieldError(wrap));
}

export function triggerInlineFieldError(wrapOrId, inputOrId, message, { autoRevertMs = 0, focusInput = true } = {}) {
  const wrap = typeof wrapOrId === 'string' ? document.getElementById(wrapOrId) : wrapOrId;
  const input = typeof inputOrId === 'string'
    ? document.getElementById(inputOrId)
    : (inputOrId || wrap?.querySelector('.t-input'));
  if (!wrap) return;

  const msgEl = wrap.querySelector('.t-error-msg');
  if (msgEl && message) msgEl.textContent = message;

  wrap.classList.add('is-error');
  if (input) {
    input.classList.add('is-error');
    input.setAttribute('aria-invalid', 'true');
    if (!prefersReducedMotion()) {
      input.classList.remove('is-shaking');
      void input.offsetWidth;
      input.classList.add('is-shaking');
      const shakeMs = readCssMs('--shake-dur-a', 80) * 2 + readCssMs('--shake-dur-b', 60) * 2;
      setTimeout(() => input.classList.remove('is-shaking'), shakeMs + 30);
    }
    if (focusInput && typeof input.focus === 'function') {
      input.focus();
    }
  }

  if (wrap.dataset.errorClearBound !== '1') {
    wrap.dataset.errorClearBound = '1';
    const clearHandler = () => clearInlineFieldError(wrap);
    wrap.addEventListener('input', clearHandler);
    wrap.addEventListener('change', clearHandler);
  }

  if (wrap._revertTimer) {
    clearTimeout(wrap._revertTimer);
    wrap._revertTimer = null;
  }
  if (autoRevertMs > 0) {
    wrap._revertTimer = setTimeout(() => clearInlineFieldError(wrap), autoRevertMs);
  }
}

export function setSubtleNumberValue(el, nextText, prevMinutes = null, nextMinutes = null) {
  if (!el) return;
  const prevText = el.dataset.lastValue ?? el.textContent ?? '';
  el.dataset.lastValue = nextText;

  if (
    prefersReducedMotion()
    || prevMinutes === null
    || nextMinutes === null
    || prevMinutes === nextMinutes
    || !prevText
    || prevText.includes('•')
    || nextText.includes('•')
    || prevText.length !== nextText.length
    || el.dataset.skipSubtleOnce === '1'
  ) {
    delete el.dataset.skipSubtleOnce;
    el.classList.remove('is-animating');
    el.textContent = nextText;
    return;
  }

  const dir = nextMinutes > prevMinutes ? 1 : -1;
  el.classList.remove('is-animating');
  el.classList.add('t-subtle-number');
  el.style.setProperty('--subtle-dir', String(dir));

  const frag = document.createDocumentFragment();
  let changedCount = 0;
  for (let i = 0; i < nextText.length; i += 1) {
    const chNew = nextText[i];
    const chOld = prevText[i];
    if (chNew !== chOld) {
      changedCount += 1;
      const slot = document.createElement('span');
      slot.className = 't-subtle-slot';
      const oldSpan = document.createElement('span');
      oldSpan.className = 't-subtle-old';
      oldSpan.setAttribute('aria-hidden', 'true');
      oldSpan.textContent = chOld;
      const newSpan = document.createElement('span');
      newSpan.className = 't-subtle-new';
      newSpan.textContent = chNew;
      slot.append(oldSpan, newSpan);
      frag.appendChild(slot);
    } else {
      frag.appendChild(document.createTextNode(chNew));
    }
  }

  if (!changedCount) {
    el.textContent = nextText;
    return;
  }

  el.replaceChildren(frag);
  void el.offsetWidth;
  el.classList.add('is-animating');

  if (el._subtleTimer) clearTimeout(el._subtleTimer);
  const dur = readCssMs('--subtle-dur', 455) + 40;
  el._subtleTimer = setTimeout(() => {
    el._subtleTimer = null;
    el.classList.remove('is-animating');
    el.textContent = el.dataset.lastValue ?? nextText;
  }, dur);
}
