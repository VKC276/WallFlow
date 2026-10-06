/**
 * Shared status banner.
 *
 * Apps Script calls take a moment, so every request says what it is doing
 * instead of only greying out a button. Nested calls are counted, so the
 * banner stays up until the last one finishes.
 */
(function (global) {
  var el = null;
  var depth = 0;

  function node() {
    if (el && el.isConnected) return el;
    el = document.getElementById('statusBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'statusBar';
      document.body.appendChild(el);
    }
    el.className = 'status-bar';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    return el;
  }

  function render(text, kind) {
    var n = node();
    n.innerHTML = '';
    if (kind !== 'error') {
      var spin = document.createElement('span');
      spin.className = 'status-spinner';
      n.appendChild(spin);
    }
    var label = document.createElement('span');
    label.textContent = text;
    n.appendChild(label);
    n.classList.toggle('is-error', kind === 'error');
    n.classList.add('is-visible');
  }

  function show(text) {
    depth++;
    render(text, 'busy');
  }

  /** Replaces the text of an ongoing operation without changing the depth. */
  function update(text) {
    if (depth > 0) render(text, 'busy');
  }

  function hide() {
    depth = Math.max(0, depth - 1);
    if (depth === 0 && el) el.classList.remove('is-visible', 'is-error');
  }

  /** Shows a message that stays until the next call, e.g. a failure. */
  function fail(text) {
    depth = 0;
    render(text, 'error');
    setTimeout(function () {
      if (depth === 0 && el) el.classList.remove('is-visible', 'is-error');
    }, 6000);
  }

  /** Wraps a promise so the banner is always cleared, success or not. */
  function during(text, promise) {
    show(text);
    return promise.then(function (res) {
      hide();
      return res;
    }, function (err) {
      hide();
      throw err;
    });
  }

  var busyButtons = new Map();

  /**
   * Puts the progress text inside the button that was pressed, which is where
   * the eye already is. Falls back to the banner when there is no button.
   */
  function button(el, text, promise) {
    if (!el) return during(text, promise);

    var original = el.innerHTML;
    var wasDisabled = el.disabled;
    el.disabled = true;
    el.classList.add('is-busy');
    el.innerHTML = '<span class="status-spinner"></span><span></span>';
    el.lastChild.textContent = text;
    // Keep the widest state so the layout does not jump back and forth.
    el.style.minWidth = Math.ceil(el.getBoundingClientRect().width) + 'px';

    var restore = function () {
      el.innerHTML = original;
      el.disabled = wasDisabled;
      el.classList.remove('is-busy');
      el.style.minWidth = '';
      busyButtons.delete(el);
    };
    busyButtons.set(el, restore);

    return promise.then(function (res) {
      restore();
      return res;
    }, function (err) {
      restore();
      throw err;
    });
  }

  /** Retries update the label of whichever button is currently working. */
  function updateBusyButtons(text) {
    busyButtons.forEach(function (_restore, el) {
      if (el.lastChild) el.lastChild.textContent = text;
    });
  }

  global.Status = {
    show: show,
    update: update,
    hide: hide,
    fail: fail,
    during: during,
    button: button
  };

  // Runs after all synchronous scripts, so Api and I18n are available whatever
  // order the page loads them in.
  function attachRetryNotice() {
    if (!global.Api) return;
    global.Api.onRetry = function () {
      var text = global.I18n ? global.I18n.t('busyRetry') : 'Försöker igen…';
      update(text);
      updateBusyButtons(text);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachRetryNotice);
  } else {
    attachRetryNotice();
  }
})(window);
