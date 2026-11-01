(function (root) {
  'use strict';

  // Factor scores use their established direction. Individual indicators use
  // their natural direction, including inputs reversed in the default factors.
  const OPTIONS = [
    { id: 'factor:value', label: 'Relative Valuation · earnings + dividend yield', short: 'Relative Valuation', detail: 'Mean of earnings-yield and dividend-yield z-scores.', kind: 'factor', key: 'value' },
    { id: 'factor:momentum', label: 'Price Momentum · 12–1 return + SMA200 distance', short: 'Price Momentum', detail: 'Mean of 12–1 return and close / SMA200 − 1 z-scores.', kind: 'factor', key: 'momentum' },
    { id: 'factor:quality', label: 'Financial Quality · ROE + direction-reversed DER', short: 'Financial Quality', detail: 'Mean of ROE z and reversed debt/equity z; financial and non-financial peer groups are separate.', kind: 'factor', key: 'quality' },
    { id: 'earnings_yield', label: 'Earnings Valuation · earnings yield', short: 'Earnings Valuation', detail: 'Natural z of supplied earnings yield or 1 / positive forward P/E.', kind: 'component' },
    { id: 'dividend_yield', label: 'Dividend Yield · trailing dividend yield', short: 'Dividend Yield', detail: 'Natural z of supplied trailing 12-month dividend yield; not a promise of future income.', kind: 'component' },
    { id: 'momentum_12_1', label: 'Long-Term Price Momentum · 12–1 return', short: 'Long-Term Price Momentum', detail: 'Natural z of close[t−21] / close[t−252] − 1.', kind: 'component' },
    { id: 'price_vs_ma200', label: 'Price Trend vs SMA200 · close / SMA200 − 1', short: 'Price Trend vs SMA200', detail: 'Natural z of close[t] / SMA200[t] − 1.', kind: 'component' },
    { id: 'roe', label: 'Profitability · return on equity', short: 'Profitability', detail: 'Natural z of ROE, standardized within the supplied financial or non-financial peer group.', kind: 'component' },
    { id: 'debt_to_equity', label: 'Leverage · debt / equity (natural direction)', short: 'Leverage', detail: 'Natural z of debt/equity; higher raw debt/equity means a higher axis value. Quality reverses this direction.', kind: 'component', baseReversed: true },
    { id: 'beta_ihsg', label: 'Market Sensitivity · IHSG beta (natural direction)', short: 'Market Sensitivity', detail: 'Natural z of OLS beta against IHSG; higher raw beta means a higher axis value. Low Volatility reverses this direction.', kind: 'component', baseReversed: true },
    { id: 'idiosyncratic_volatility', label: 'Issuer-Specific Volatility · OLS residual volatility', short: 'Issuer-Specific Volatility', detail: 'Natural z of daily OLS residual volatility; higher raw volatility means a higher axis value. Low Volatility reverses this direction.', kind: 'component', baseReversed: true }
  ];
  const BY_ID = Object.fromEntries(OPTIONS.map(item => [item.id, item]));
  // These are descriptive ranking preferences, not claims of investment merit.
  // Beta is intentionally higher by default to match the High Beta preset.
  const LOWER_PREFERRED = new Set(['debt_to_equity', 'idiosyncratic_volatility']);
  const PRESETS = {
    classic: { x: 'factor:value', y: 'factor:momentum', z: 'factor:quality' },
    relative_value: { x: 'earnings_yield', y: 'dividend_yield', z: 'factor:quality' },
    high_beta_quality: { x: 'beta_ihsg', y: 'factor:quality', z: 'debt_to_equity' }
  };
  let selection = { ...PRESETS.classic };
  let selectedPreset = 'classic';

  function axisValue(record, id) {
    const option = BY_ID[id];
    if (!option) return null;
    const item = option.kind === 'factor' ? record.scores?.[option.key] : record.components?.[id];
    const raw = option.kind === 'factor' ? item?.score : item?.z_score;
    if (item?.status !== 'AVAILABLE' || raw == null || raw === '' || !Number.isFinite(Number(raw))) return null;
    return Number(raw) * (option.baseReversed ? -1 : 1);
  }

  function lowVolatility(record) {
    const value = record.scores?.low_volatility;
    return value?.status === 'AVAILABLE' && value.score != null && value.score !== '' && Number.isFinite(Number(value.score))
      ? Number(value.score) : null;
  }

  function defaultRankDirection(id) {
    if (!BY_ID[id]) throw new Error('Unknown axis indicator.');
    return LOWER_PREFERRED.has(id) ? 'lower' : 'higher';
  }

  function rankScore(value, direction) {
    if (direction !== 'higher' && direction !== 'lower') throw new Error('Invalid ranking direction.');
    if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
    const score = Number(value) * (direction === 'lower' ? -1 : 1);
    return Object.is(score, -0) ? 0 : score;
  }

  function mapPoints(records, axes) {
    if (!axes || !['x', 'y', 'z'].every(key => BY_ID[axes[key]])) throw new Error('Each X, Y, and Z axis needs a supported factor or indicator.');
    return (Array.isArray(records) ? records : []).map(record => ({
      record, x: axisValue(record, axes.x), y: axisValue(record, axes.y),
      z: axisValue(record, axes.z), low: lowVolatility(record)
    })).filter(point => point.x !== null && point.y !== null && point.z !== null);
  }

  const api = { OPTIONS, PRESETS, axisValue, mapPoints, defaultRankDirection, rankScore,
    getOption: id => BY_ID[id], getSelection: () => ({ ...selection }), getPreset: () => selectedPreset, onChange: () => {} };
  root.FactorAxes = api;
  if (typeof document === 'undefined') return;

  const preset = document.getElementById('axis-preset');
  const selects = Object.fromEntries(['x', 'y', 'z'].map(key => [key, document.getElementById(`axis-${key}`)]));
  if (!preset || Object.values(selects).some(item => !item)) return;
  for (const [axis, select] of Object.entries(selects)) {
    for (const option of OPTIONS) {
      const element = document.createElement('option'); element.value = option.id; element.textContent = option.label; select.append(element);
    }
    select.value = selection[axis];
    select.addEventListener('change', () => {
      if (!BY_ID[select.value]) return;
      selection[axis] = select.value;
      selectedPreset = 'custom';
      preset.value = 'custom';
      api.onChange(api.getSelection());
    });
  }
  preset.addEventListener('change', () => {
    if (!PRESETS[preset.value]) return;
    selection = { ...PRESETS[preset.value] };
    selectedPreset = preset.value;
    for (const axis of ['x', 'y', 'z']) selects[axis].value = selection[axis];
    api.onChange(api.getSelection());
  });
})(typeof window !== 'undefined' ? window : globalThis);
