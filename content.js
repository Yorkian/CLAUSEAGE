(function () {
  'use strict';

  const WIDGET_ID = 'claude-usage-widget';
  const IFRAME_ID = 'claude-usage-iframe';
  const STORAGE_KEY = 'claude-usage-widget-pos';
  const MARGIN_RIGHT = 16;
  const MARGIN_BOTTOM = 16;
  const POLL_INTERVAL = 500;
  const MAX_POLLS = 40;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  let autoRefreshTimer = null;
  let lastRefreshTime = null;
  let updatedTickerTimer = null;
  let wasDragged = false;
  let savedTop = null;

  const GITHUB_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33c.85 0 1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2Z"/></svg>';

  // ── SPA Navigation ──
  function isOnChatPage() {
    return location.pathname.startsWith('/chat/');
  }

  function showWidget() {
    var w = document.getElementById(WIDGET_ID);
    if (w) w.style.display = '';
  }

  function hideWidget() {
    var w = document.getElementById(WIDGET_ID);
    if (w) w.style.display = 'none';
  }

  function monitorNavigation() {
    var lastPath = location.pathname;
    var check = function () {
      var curPath = location.pathname;
      if (curPath === lastPath) return;
      lastPath = curPath;
      onRouteChange();
    };
    var origPush = history.pushState;
    history.pushState = function () {
      origPush.apply(this, arguments);
      setTimeout(check, 0);
    };
    var origReplace = history.replaceState;
    history.replaceState = function () {
      origReplace.apply(this, arguments);
      setTimeout(check, 0);
    };
    window.addEventListener('popstate', check);
    setInterval(check, 1000);
  }

  function onRouteChange() {
    if (isOnChatPage()) {
      ensureWidget();
      showWidget();
    } else {
      hideWidget();
    }
  }

  // ── Widget creation ──
  function ensureWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    createWidget();
    fetchUsageData();
    scheduleAutoRefresh();
  }

  function createWidget() {
    var wrap = document.createElement('div');
    wrap.id = WIDGET_ID;
    wrap.innerHTML =
      '<div class="cuw-header" id="cuw-drag-handle">' +
        '<span class="cuw-title">CLAUSEAGE</span>' +
        '<div class="cuw-actions">' +
          '<button class="cuw-btn" id="cuw-refresh" title="Refresh">' +
            '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M1.5 2v4.5H6"/>' +
              '<path d="M2.2 10.2a6 6 0 1 0 .6-6.7L1.5 6.5"/>' +
            '</svg>' +
          '</button>' +
          '<button class="cuw-btn" id="cuw-minimize" title="Minimize">' +
            '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
              '<line x1="3" y1="8" x2="13" y2="8"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cuw-body" id="cuw-body">' +
        '<div class="cuw-loading">Loading…</div>' +
      '</div>';
    document.body.appendChild(wrap);

    // Restore position
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.wasDragged) {
        wasDragged = true;
        savedTop = saved.top;
      }
    } catch (_) {}
    applyPosition(wrap);

    initDrag(wrap, document.getElementById('cuw-drag-handle'));

    window.addEventListener('resize', function () {
      var w = document.getElementById(WIDGET_ID);
      if (w) applyPosition(w);
    });

    var minBtn = document.getElementById('cuw-minimize');
    minBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var collapsed = wrap.classList.toggle('cuw-collapsed');
      minBtn.title = collapsed ? 'Expand' : 'Minimize';
      minBtn.innerHTML = collapsed
        ? '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>'
        : '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/></svg>';
    });

    document.getElementById('cuw-refresh').addEventListener('click', function (e) {
      e.stopPropagation();
      fetchUsageData();
      scheduleAutoRefresh();
    });

    return wrap;
  }

  // ── Position logic ──
  function applyPosition(el) {
    if (!wasDragged) {
      el.style.right = MARGIN_RIGHT + 'px';
      el.style.bottom = MARGIN_BOTTOM + 'px';
      el.style.left = 'auto';
      el.style.top = 'auto';
      return;
    }
    var rect = el.getBoundingClientRect();
    var left = window.innerWidth - rect.width - MARGIN_RIGHT;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = left + 'px';
    var t = savedTop;
    if (t < 0) t = 0;
    if (t + rect.height > window.innerHeight) t = window.innerHeight - rect.height;
    el.style.top = t + 'px';
  }

  // ── Drag logic ──
  function initDrag(el, handle) {
    var startX, startY, startLeft, startTop, dragging = false;

    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('.cuw-btn')) return;
      e.preventDefault();
      dragging = true;
      var rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.classList.add('cuw-dragging');
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      el.style.left = (startLeft + (e.clientX - startX)) + 'px';
      el.style.top = (startTop + (e.clientY - startY)) + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('cuw-dragging');
      clampToViewport(el);
      var rect = el.getBoundingClientRect();
      wasDragged = true;
      savedTop = rect.top;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ top: savedTop, wasDragged: true }));
      applyPosition(el);
    });
  }

  function clampToViewport(el) {
    var rect = el.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var l = rect.left, t = rect.top;
    if (l < 0) l = 0;
    if (t < 0) t = 0;
    if (l + rect.width > vw) l = vw - rect.width;
    if (t + rect.height > vh) t = vh - rect.height;
    el.style.left = l + 'px';
    el.style.top = t + 'px';
  }

  // ── Parse usage data ──
  function parseUsage(doc) {
    var data = { sections: [], plan: '' };
    var allText = doc.body.innerText;
    if (!allText || allText.includes('Sign in') || allText.includes('Log in')) return null;

    // ── Extract plan name (e.g. "Pro", "Team", "Free") ──
    // It appears near "Plan usage limits" as a badge
    var planWalker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    while (planWalker.nextNode()) {
      var ptxt = planWalker.currentNode.textContent.trim();
      if (/^(Free|Pro|Team|Enterprise|Max)$/i.test(ptxt)) {
        data.plan = ptxt;
        break;
      }
    }

    // ── Detect Current balance globally ──
    var currentBalance = null;
    var balWalker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    while (balWalker.nextNode()) {
      if (/current balance/i.test(balWalker.currentNode.textContent.trim())) {
        // Look at nearby sibling/parent for dollar amount
        var balEl = balWalker.currentNode.parentElement;
        for (var d = 0; d < 5 && balEl; d++) {
          var balText = balEl.innerText || '';
          var balMatch = balText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
          if (balMatch) {
            currentBalance = parseFloat(balMatch[1].replace(/,/g, ''));
            break;
          }
          balEl = balEl.parentElement;
        }
        break;
      }
    }

    var hideExtraUsage = (currentBalance === null || currentBalance === 0);

    // ── Find "% used" sections ──
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    var usageTexts = [];
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim().includes('% used')) usageTexts.push(walker.currentNode);
    }

    usageTexts.forEach(function (node) {
      var pctMatch = node.textContent.match(/(\d+)%\s*used/);
      if (!pctMatch) return;
      var pct = parseInt(pctMatch[1], 10);
      var container = findAncestorBlock(node);
      if (!container) return;
      var blockText = container.innerText || '';
      var lines = blockText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

      var label = '', resetInfo = '';
      lines.forEach(function (line) {
        if (/current session|all models/i.test(line)) label = line;
        if (/resets?\s/i.test(line)) resetInfo = line;
      });
      if (!label) {
        label = lines.find(function (l) { return !l.includes('% used') && !l.includes('Resets') && !l.includes('Learn more'); }) || 'Unknown';
      }

      // Filter: if label contains "$" (e.g. "$0.00 spent"), it's Extra usage
      if (/\$/.test(label) && hideExtraUsage) return;

      data.sections.push({ type: 'pct', label: label, pct: pct, resetInfo: resetInfo });
    });

    return data.sections.length > 0 ? data : null;
  }

  function findAncestorBlock(node) {
    var el = node.parentElement;
    var depth = 0;
    while (el && depth < 15) {
      var text = el.innerText || '';
      if ((text.includes('Resets') || text.includes('Reset')) && text.includes('% used')) return el;
      el = el.parentElement;
      depth++;
    }
    return node.parentElement && node.parentElement.parentElement && node.parentElement.parentElement.parentElement || null;
  }

  // ── Relative time + ticker ──
  function getRelativeTimeText() {
    if (!lastRefreshTime) return '';
    var elapsed = Math.floor((Date.now() - lastRefreshTime) / 1000);
    if (elapsed < 30)  return 'Updated: just now';
    if (elapsed < 60)  return 'Updated: half a minute ago';
    if (elapsed < 120) return 'Updated: a minute ago';
    if (elapsed < 180) return 'Updated: 2 minutes ago';
    if (elapsed < 240) return 'Updated: 3 minutes ago';
    if (elapsed < 290) return 'Updated: 4 minutes ago';
    return 'Refreshing soon';
  }

  function stopUpdatedTicker() {
    if (updatedTickerTimer) { clearInterval(updatedTickerTimer); updatedTickerTimer = null; }
  }

  function startUpdatedTicker() {
    stopUpdatedTicker();
    updatedTickerTimer = setInterval(function () {
      var el = document.getElementById('cuw-updated-line');
      if (el) el.textContent = getRelativeTimeText();
    }, 1000);
  }

  // ── Render data ──
  function renderData(data) {
    var body = document.getElementById('cuw-body');
    if (!data) {
      body.innerHTML = '<div class="cuw-empty">Unable to load</div>';
      return;
    }

    lastRefreshTime = Date.now();

    // Update title with plan name
    var titleEl = document.querySelector('#' + WIDGET_ID + ' .cuw-title');
    if (titleEl) {
      if (data.plan) {
        titleEl.innerHTML = 'CLAUSEAGE <span class="cuw-plan">| ' + escapeHtml(data.plan) + '</span>';
      } else {
        titleEl.textContent = 'CLAUSEAGE';
      }
    }

    var html = '';
    data.sections.forEach(function (s) {
      var barColor = s.pct >= 90 ? '#ef4444' : s.pct >= 70 ? '#f59e0b' : '#6b8afd';
      html +=
        '<div class="cuw-row">' +
          '<div class="cuw-row-top">' +
            '<span class="cuw-label">' + escapeHtml(s.label) + '</span>' +
            '<span class="cuw-pct">' + s.pct + '%</span>' +
          '</div>' +
          '<div class="cuw-bar-track">' +
            '<div class="cuw-bar-fill" style="width:' + s.pct + '%;background:' + barColor + '"></div>' +
          '</div>' +
          (s.resetInfo ? '<div class="cuw-reset">' + escapeHtml(s.resetInfo) + '</div>' : '') +
        '</div>';
    });

    html +=
      '<div class="cuw-footer">' +
        '<span class="cuw-updated" id="cuw-updated-line">' + getRelativeTimeText() + '</span>' +
        '<a class="cuw-github" href="https://github.com/Yorkian/CLAUSEAGE" target="_blank" title="GitHub">' + GITHUB_SVG + '</a>' +
      '</div>';

    body.innerHTML = html;
    startUpdatedTicker();
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Fetch data via hidden iframe ──
  function fetchUsageData() {
    stopUpdatedTicker();

    var body = document.getElementById('cuw-body');
    if (body) body.innerHTML = '<div class="cuw-loading"><span class="cuw-spinner"></span> Loading…</div>';

    var old = document.getElementById(IFRAME_ID);
    if (old) old.remove();

    var iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = 'https://claude.ai/settings/usage';
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;opacity:0;pointer-events:none;top:-9999px;left:-9999px;';
    document.body.appendChild(iframe);

    var polls = 0;
    var timer = setInterval(function () {
      polls++;
      try {
        var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!doc || !doc.body) {
          if (polls >= MAX_POLLS) { clearInterval(timer); iframe.remove(); renderData(null); }
          return;
        }

        var currentUrl = (iframe.contentWindow && iframe.contentWindow.location && iframe.contentWindow.location.href) || '';
        if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
          clearInterval(timer); iframe.remove(); hideWidget(); return;
        }

        var text = doc.body.innerText || '';

        if (text.includes('% used')) {
          clearInterval(timer);
          var data = parseUsage(doc);
          renderData(data);
          iframe.remove();
          return;
        }

        if (text.includes('Sign in') || text.includes('Log in') || text.includes('Continue with')) {
          clearInterval(timer); iframe.remove(); hideWidget(); return;
        }

      } catch (e) {
        if (e.name === 'SecurityError' || (e.message && e.message.includes('cross-origin'))) {
          clearInterval(timer); iframe.remove(); hideWidget(); return;
        }
      }

      if (polls >= MAX_POLLS) { clearInterval(timer); iframe.remove(); renderData(null); }
    }, POLL_INTERVAL);
  }

  // ── Auto-refresh ──
  function scheduleAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(function () {
      fetchUsageData();
    }, AUTO_REFRESH_MS);
  }

  // ── Init ──
  monitorNavigation();
  if (isOnChatPage()) {
    ensureWidget();
  }

})();
