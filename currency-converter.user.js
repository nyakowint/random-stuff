// ==UserScript==
// @name         Currency Converter
// @namespace    nnvibeslop.currencyconverter
// @version      1.1.0
// @description  Highlight a price to see a popup with your currency's equivalent. Caches daily rates
// @match        https://*/*
// @match        http://*/*
// @run-at       document-idle
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @connect      latest.currency-api.pages.dev
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/nyakowint/random-stuff/main/currency-converter.user.js
// @updateURL    https://raw.githubusercontent.com/nyakowint/random-stuff/main/currency-converter.user.js
// ==/UserScript==

// based on this extension: https://chromewebstore.google.com/detail/hover-currency-converter/plbdgcecigogedfihfmabohdbbbokfka
// but parsing on hover is like insane so not using that + also yet another extension lmao

(() => {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const CACHE_LIFETIME = DAY / 2;
  const MAX_RATE_AGE = 7 * DAY;
  const RETRY_DELAY = 5 * 60 * 1000;
  const SELECTION_DELAY = 180;
  const MAX_SELECTION_LENGTH = 2000;
  const THREE_DECIMAL_CURRENCIES = ['BHD', 'KWD', 'OMR', 'JOD', 'TND'];
  const RATE_URLS = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
  ];
  const CODES = new Set(Intl.supportedValuesOf('currency'));
  const SYMBOLS = {
    'US$': 'USD', 'CA$': 'CAD', 'C$': 'CAD', 'AU$': 'AUD', 'A$': 'AUD',
    'NZ$': 'NZD', 'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD', 'SG$': 'SGD',
    'R$': 'BRL', 'MX$': 'MXN', 'CN¥': 'CNY', 'JP¥': 'JPY',
    '€': 'EUR', '£': 'GBP', '₹': 'INR', '₩': 'KRW', '₽': 'RUB',
    '₺': 'TRY', '₫': 'VND', '฿': 'THB', '₴': 'UAH', '₱': 'PHP',
    '₪': 'ILS', '₦': 'NGN', '₡': 'CRC', '₲': 'PYG', '₸': 'KZT',
    'zł': 'PLN', 'Kč': 'CZK', 'Ft': 'HUF', '元': 'CNY', '円': 'JPY',
  };
  const AMBIGUOUS = {
    '$': ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'TWD', 'MXN', 'ARS', 'CLP', 'COP'],
    '¥': ['JPY', 'CNY'], '￥': ['JPY', 'CNY'],
    'kr': ['SEK', 'NOK', 'DKK', 'ISK'], 'Rs': ['INR', 'PKR', 'LKR', 'NPR', 'MUR'],
  };
  const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = [...CODES, ...Object.keys(SYMBOLS), ...Object.keys(AMBIGUOUS)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  const space = '[ \\t\\u00a0\\u202f]*';
  const number = '[0-9]+(?:[.,\u2019\x27 \\u00a0\\u202f][0-9]+)*';
  const prefix = new RegExp(`(?<![\\p{L}\\p{N}_])(${tokens})${space}(-?${number})(?![\\p{L}\\p{N}_]|[.,][0-9])`, 'gu');
  const suffix = new RegExp(`(?<![\\p{L}\\p{N}_.,])(-?${number})${space}(${tokens})(?![\\p{L}\\p{N}_])`, 'gu');

  function parseAmount(raw, currency) {
    let normalized = raw.replace(/[\u00a0\u202f]/g, ' ').replace(/’/g, "'");
    const negative = normalized.startsWith('-');
    if (negative) normalized = normalized.slice(1);

    const dot = normalized.lastIndexOf('.');
    const comma = normalized.lastIndexOf(',');
    let decimal = '';
    if (dot >= 0 && comma >= 0) decimal = dot > comma ? '.' : ',';
    else if (dot >= 0 || comma >= 0) {
      const separator = dot >= 0 ? '.' : ',';
      const parts = normalized.split(separator);
      if (parts.length === 2 && (parts[1].length !== 3 || THREE_DECIMAL_CURRENCIES.includes(currency))) {
        decimal = separator;
      }
    }
    const parts = decimal ? normalized.split(decimal) : [normalized];
    if (parts.length > 2 || (decimal && !/^\d{1,3}$/.test(parts[1]))) return null;
    const integer = parts[0];
    const grouping = [...new Set(integer.match(/[^0-9]/g) || [])];
    if (grouping.length > 1) return null;
    if (grouping.length) {
      const separator = escapeRegex(grouping[0]);
      const westernGrouping = new RegExp(`^\\d{1,3}(?:${separator}\\d{3})+$`);
      const indianGrouping = new RegExp(`^\\d{1,2}(?:${separator}\\d{2})*${separator}\\d{3}$`);
      if (!westernGrouping.test(integer) && !indianGrouping.test(integer)) return null;
    }
    const digits = integer.replace(/[^0-9]/g, '');
    const fraction = decimal ? '.' + parts[1] : '';
    const value = Number(digits + fraction) * (negative ? -1 : 1);
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
  }

  function resolveCurrency(token, overrides) {
    const choices = AMBIGUOUS[token];
    if (!choices) return SYMBOLS[token] || token;

    const choice = overrides[token];
    return choices.includes(choice) ? choice : choices[0];
  }

  function findPrices(text, overrides = {}) {
    const found = [];
    for (const [regex, isPrefix] of [[prefix, true], [suffix, false]]) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        const token = match[isPrefix ? 1 : 2];
        const raw = match[isPrefix ? 2 : 1];
        const currency = resolveCurrency(token, overrides);
        const value = parseAmount(raw, currency);
        if (value === null) continue;
        const start = match.index;
        const end = start + match[0].length;
        if (found.some(price => price.start < end && start < price.end)) continue;
        found.push({ start, end, value, currency, token, assumed: !!AMBIGUOUS[token], source: match[0] });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  function findForeignPrice(text, overrides = {}) {
    return findPrices(text, overrides).find(price => price.currency !== 'USD');
  }

  function validRates(data) {
    return !!data && /^\d{4}-\d{2}-\d{2}$/.test(data.date) &&
      Number.isFinite(Date.parse(data.date)) && Date.parse(data.date) <= Date.now() + DAY &&
      data.usd?.usd === 1 && Number.isFinite(data.usd.eur) && data.usd.eur > 0 &&
      Object.values(data.usd).every(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
  }

  function convert(value, currency, data) {
    const rate = data?.usd?.[currency?.toLowerCase()];
    return Number.isFinite(rate) && rate > 0 ? value / rate : null;
  }

  if (typeof module === 'object' && module.exports && typeof document === 'undefined') {
    module.exports = { parseAmount, findPrices, findForeignPrice, validRates, convert };
    return;
  }

  const siteKey = `site:${location.hostname}`;
  let settings = read(siteKey, {});
  if (!settings || typeof settings !== 'object') settings = {};
  let cached = read('rates', null);
  let pendingRates = null;
  let retryAfter = 0;
  let selectionVersion = 0;
  let selectionTimer = 0;
  let tooltipHost;
  let tooltipBox;
  let selecting = false;
  let lastConversion = null;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  function read(key, fallback) {
    try {
      return GM_getValue(key, fallback);
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      GM_setValue(key, value);
    } catch {
      // Storage failure should not prevent conversion.
    }
  }

  function usable(data) {
    return validRates(data) && Date.now() - Date.parse(data.date) < MAX_RATE_AGE;
  }

  function requestRates(url) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'GET',
      url,
      anonymous: true,
      timeout: 10000,
      onload(response) {
        try {
          const data = JSON.parse(response.responseText);
          if (response.status !== 200 || !usable(data)) throw new Error('Invalid or old exchange rates');
          resolve(data);
        } catch (error) {
          reject(error);
        }
      },
      onerror: () => reject(new Error('Network error')),
      ontimeout: () => reject(new Error('Rate request timed out')),
      onabort: () => reject(new Error('Rate request aborted')),
    }));
  }
  async function loadRates(force = false) {
    const stored = read('rates', null);
    if (usable(stored) && (!usable(cached) || stored.fetchedAt > cached.fetchedAt)) cached = stored;
    const cacheAge = Date.now() - cached?.fetchedAt;
    if (!force && usable(cached) && cacheAge >= 0 && cacheAge < CACHE_LIFETIME) return cached;
    if (pendingRates) return pendingRates;
    if (!force && Date.now() < retryAfter) {
      if (usable(cached)) return cached;
      throw new Error('Rates unavailable. Try Refresh rates in the script menu.');
    }
    pendingRates = refreshRates();
    try {
      return await pendingRates;
    } finally {
      pendingRates = null;
    }
  }

  async function refreshRates() {
    for (const url of RATE_URLS) {
      try {
        cached = { ...await requestRates(url), fetchedAt: Date.now() };
        save('rates', cached);
        retryAfter = 0;
        return cached;
      } catch {
        // Try the next provider before falling back to the cache.
      }
    }
    retryAfter = Date.now() + RETRY_DELAY;
    if (usable(cached)) return cached;
    throw new Error('Rates unavailable. Try Refresh rates in the script menu.');
  }

  function hide() {
    selectionVersion++;
    clearTimeout(selectionTimer);
    if (tooltipHost) tooltipHost.style.setProperty('display', 'none', 'important');
  }

  function createTooltip() {
    tooltipHost = document.createElement('selection-usd-tooltip');
    tooltipHost.style.cssText = `
      all: initial !important;
      position: fixed !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      display: none !important;
    `;
    const shadow = tooltipHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme: dark; }
      .box {
        box-sizing: border-box;
        max-width: calc(100vw - 16px);
        padding: 5px 8px;
        border: 1px solid #475569;
        border-radius: 5px;
        background: #0f172a;
        color: #f8fafc;
        box-shadow: 0 2px 8px #0003;
        font: 13px/1.4 system-ui, sans-serif;
        overflow-wrap: anywhere;
        text-align: left;
        user-select: none;
      }
    `;
    tooltipBox = document.createElement('div');
    tooltipBox.className = 'box';
    tooltipBox.setAttribute('role', 'tooltip');
    shadow.append(style, tooltipBox);
  }

  function show(result, selectionRect) {
    if (!tooltipHost) createTooltip();
    if (!tooltipHost.isConnected) document.documentElement.append(tooltipHost);

    tooltipBox.textContent = result;
    tooltipHost.style.setProperty('display', 'block', 'important');

    const bounds = tooltipBox.getBoundingClientRect();
    const left = Math.max(8, Math.min(selectionRect.left, innerWidth - bounds.width - 8));
    const above = selectionRect.top - bounds.height - 6;
    const below = Math.min(selectionRect.bottom + 6, innerHeight - bounds.height - 8);
    const top = Math.max(8, above >= 8 ? above : below);

    tooltipHost.style.setProperty('left', `${left}px`, 'important');
    tooltipHost.style.setProperty('top', `${top}px`, 'important');
  }

  async function convertSelection(version) {
    const activeElement = document.activeElement;
    const isEditing = activeElement?.matches('input,textarea,select') || activeElement?.isContentEditable;
    if (settings.disabled || document.hidden || isEditing) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const text = selection.toString();
    if (text.length > MAX_SELECTION_LENGTH) return;
    const price = findForeignPrice(text, settings.symbols || {});
    if (!price) return;
    const range = selection.getRangeAt(0).cloneRange();
    const rect = [...range.getClientRects()].find(r => r.width && r.height);
    if (!rect) return;
    lastConversion = { source: price.source, currency: price.currency, assumed: price.assumed };
    try {
      const data = await loadRates();
      const selectionChanged = version !== selectionVersion || window.getSelection()?.toString() !== text;
      if (selectionChanged || !range.startContainer.isConnected || document.hidden) return;
      const result = convert(price.value, price.currency, data);
      lastConversion.date = data.date;
      lastConversion.cached = Date.now() - Date.parse(data.date) > 2 * DAY || retryAfter > Date.now();
      if (result === null || !Number.isFinite(result)) {
        show('USD unavailable', rect);
        return;
      }
      show(`≈ ${money.format(result)} USD`, rect);
    } catch (error) {
      if (version === selectionVersion) {
        lastConversion.error = error.message;
        show('USD unavailable', rect);
      }
    }
  }
  function scheduleConversion() {
    hide();
    if (selecting || settings.disabled) return;
    const version = selectionVersion;
    selectionTimer = setTimeout(() => convertSelection(version), SELECTION_DELAY);
  }

  document.addEventListener('selectionchange', scheduleConversion);
  document.addEventListener('pointerdown', () => {
    selecting = true;
    hide();
  }, { passive: true });
  document.addEventListener('pointerup', () => {
    selecting = false;
    scheduleConversion();
  }, { passive: true });
  document.addEventListener('pointercancel', () => {
    selecting = false;
    hide();
  }, { passive: true });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('blur', () => {
    selecting = false;
    hide();
  });
  window.addEventListener('resize', hide);

  GM_registerMenuCommand('Currency settings for this site…', () => {
    const defaults = Object.entries(AMBIGUOUS).filter(([symbol]) => symbol !== '￥')
      .map(([symbol, choices]) => `${symbol}=${settings.symbols?.[symbol] || choices[0]}`).join(', ');
    const answer = prompt(`Set ambiguous symbols for ${location.hostname}.\nExample: $=CAD, ¥=CNY, kr=NOK, Rs=INR\nExplicit currency codes always keep their meaning. Blank restores defaults.`, defaults);
    if (answer === null) return;
    const symbols = {};
    for (const entry of answer.split(',').filter(s => s.trim())) {
      const [symbol, currency, extra] = entry.split('=').map(s => s.trim());
      if (extra !== undefined || !AMBIGUOUS[symbol]?.includes(currency?.toUpperCase())) {
        alert(`Invalid choice: ${entry}.\n${AMBIGUOUS[symbol]?.join(', ') || 'Use $, ¥, kr, or Rs followed by = and a currency code.'}`);
        return;
      }
      symbols[symbol] = currency.toUpperCase();
      if (symbol === '¥' || symbol === '￥') symbols['¥'] = symbols['￥'] = currency.toUpperCase();
    }
    settings.symbols = symbols;
    save(siteKey, settings);
    hide();
  });
  GM_registerMenuCommand('Toggle conversion on this site', () => {
    settings.disabled = !settings.disabled;
    save(siteKey, settings);
    hide();
    alert(`Selection to USD is ${settings.disabled ? 'disabled' : 'enabled'} on ${location.hostname}.`);
  });
  GM_registerMenuCommand('Last conversion details', () => {
    if (!lastConversion) {
      alert('Highlight a price first.');
      return;
    }
    const info = lastConversion;
    const lines = [info.source];
    const assumption = info.assumed ? ' (symbol default; change in Currency settings)' : '';
    lines.push(`Source: ${info.currency}${assumption}`);
    if (info.date) lines.push(`Rates: ${info.date}${info.cached ? ' (cached)' : ''}`);
    lines.push(info.error || 'Approximate equivalent; excludes bank/card fees.');
    alert(lines.join('\n'));
  });
  GM_registerMenuCommand('Refresh exchange rates', async () => {
    try {
      const data = await loadRates(true);
      alert(`Rates dated ${data.date}.${retryAfter > Date.now() ? ' Update failed; using cached rates.' : ''}`);
    } catch (error) {
      alert(error.message);
    }
  });
})();
