(function () {
  'use strict';

  const ROOT = new URL('../', document.currentScript.src);
  const DATA_URL = new URL('data/demo-universe.json', ROOT);
  const MATLAB_VIEW_URL = new URL('data/factor-zoo-view.json', ROOT);
  const RESET_VIEW = { yaw: -37.5 * Math.PI / 180, pitch: 28 * Math.PI / 180, zoom: 1 };
  const FACTOR_LABELS = {
    value: 'Value · lowest relative valuation',
    quality: 'Quality · strongest fundamentals',
    momentum: 'Momentum · strongest trend',
    low_volatility: 'Low Volatility · lowest relative risk'
  };

  const canvas = document.getElementById('factor-zoo-canvas');
  const ctx = canvas.getContext('2d');
  const frame = canvas.closest('.chart-frame');
  const tooltip = frame.querySelector('.tooltip');
  const loadState = document.getElementById('load-state');
  const state = {
    data: null,
    view: { ...RESET_VIEW },
    width: 0,
    height: 0,
    points: [],
    hovered: null,
    drag: null,
    drawing: false,
    followMatlab: false,
    lastMatlabView: '',
    pollTimer: null
  };

  function isAvailableScore(value) {
    return value && value.status === 'AVAILABLE' && Number.isFinite(Number(value.score));
  }

  function factorScoreLabel(value) {
    return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
  }

  function factorValueLabel(value) {
    return value == null || value === '' || !Number.isFinite(Number(value))
      ? '—'
      : Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 });
  }

  function signedFactorScore(value) {
    return value == null || !Number.isFinite(Number(value))
      ? '—'
      : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}σ`;
  }

  function percentInput(value) {
    return value == null || !Number.isFinite(Number(value))
      ? 'unavailable'
      : `${(Number(value) * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function ratioInput(value) {
    return value == null || !Number.isFinite(Number(value))
      ? 'unavailable'
      : Number(value).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function componentLine(label, component, format) {
    if (!component || component.status !== 'AVAILABLE' || component.value == null) {
      return `  ${label}: unavailable (${component?.status || 'NO DATA'})`;
    }
    const componentScore = component.z_score == null ? 'not scored' : signedFactorScore(component.z_score);
    const peerCount = component.peer_count == null ? 'peer count unavailable' : `n=${component.peer_count} eligible peers`;
    return `  ${label}: ${format(component.value)} · component z ${componentScore} · ${peerCount}`;
  }

  function factorBlock(label, score, componentLines) {
    const value = signedFactorScore(score?.score);
    const status = score?.status || 'UNAVAILABLE';
    return `${label}: ${value} (${status}) · mean of component z-scores\n${componentLines.join('\n')}`;
  }

  function project(x, y, z) {
    const az = state.view.yaw;
    const el = state.view.pitch;
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    const X = x / 3, Y = y / 3, Z = z / 3;
    const rx = X * ca - Y * sa;
    const ry0 = X * sa + Y * ca;
    const vertical = ry0 * se + Z * ce;
    const depth = ry0 * ce - Z * se;
    const perspective = 9 / (9 + depth);
    const scale = Math.min(state.width * 0.27, state.height * 0.21) * state.view.zoom;
    return {
      x: state.width * 0.47 + rx * scale * perspective,
      y: state.height * 0.50 - vertical * scale * perspective,
      depth
    };
  }

  function parulaColor(value) {
    if (!Number.isFinite(Number(value))) return '#778493';
    const stops = [
      ['#352a87', [53, 42, 135]], ['#0f5cdd', [15, 92, 221]],
      ['#128ac0', [18, 138, 192]], ['#00bf87', [0, 191, 135]],
      ['#76d34b', [118, 211, 75]], ['#f9e721', [249, 231, 33]]
    ];
    const t = Math.max(0, Math.min(1, (Number(value) + 3) / 6)) * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(t));
    const fraction = t - index;
    const from = stops[index][1], to = stops[index + 1][1];
    return `rgb(${from.map((channel, i) => Math.round(channel + (to[i] - channel) * fraction)).join(',')})`;
  }

  function drawAxes() {
    const ticks = [-3, -2, -1, 0, 1, 2, 3];
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(103,125,145,.31)';
    // XY floor and the rear XZ/YZ panes match the source Factor Zoo plot.
    for (const tick of ticks) {
      const segments = [
        [project(-3, tick, -3), project(3, tick, -3)],
        [project(tick, -3, -3), project(tick, 3, -3)],
        [project(-3, -3, tick), project(3, -3, tick)],
        [project(-3, tick, -3), project(-3, tick, 3)],
        [project(tick, -3, -3), project(tick, -3, 3)]
      ];
      for (const [a, b] of segments) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    const edges = [
      [[-3,-3,-3],[3,-3,-3]], [[-3,-3,-3],[-3,3,-3]], [[-3,-3,-3],[-3,-3,3]],
      [[3,-3,-3],[3,3,-3]], [[3,-3,-3],[3,-3,3]], [[-3,3,-3],[3,3,-3]],
      [[-3,3,-3],[-3,3,3]], [[-3,-3,3],[3,-3,3]], [[-3,-3,3],[-3,3,3]],
      [[3,3,-3],[3,3,3]], [[3,-3,3],[3,3,3]], [[-3,3,3],[3,3,3]]
    ];
    ctx.strokeStyle = 'rgba(174,190,203,.78)';
    ctx.lineWidth = 1.35;
    for (const [[x1,y1,z1],[x2,y2,z2]] of edges) {
      const a = project(x1,y1,z1), b = project(x2,y2,z2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    ctx.font = '12px Inter,-apple-system,sans-serif';
    ctx.fillStyle = '#dce5ed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tick of ticks) {
      let point = project(tick, -3, -3); ctx.fillText(String(tick), point.x, point.y + 15);
      point = project(-3, tick, -3); ctx.fillText(String(tick), point.x - 16, point.y + 2);
      point = project(-3, -3, tick); ctx.textAlign = 'right'; ctx.fillText(String(tick), point.x - 10, point.y); ctx.textAlign = 'center';
    }

    ctx.font = '600 13px Inter,-apple-system,sans-serif';
    ctx.fillStyle = '#e4ebf2';
    const axisLabel = (label, start, end, offset = 17) => {
      const a = project(...start), b = project(...end);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      let readable = angle;
      if (readable > Math.PI / 2) readable -= Math.PI;
      else if (readable < -Math.PI / 2) readable += Math.PI;
      const midpoint = project((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
      const normalX = -Math.sin(readable), normalY = Math.cos(readable);
      ctx.save();
      ctx.translate(midpoint.x + normalX * offset, midpoint.y + normalY * offset);
      ctx.rotate(readable);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    };
    axisLabel('Value (X)', [-3, -3, -3], [3, -3, -3], 22);
    axisLabel('Momentum (Y)', [-3, -3, -3], [-3, 3, -3], 22);
    axisLabel('Quality (Z)', [-3, -3, -3], [-3, -3, 3], 22);
  }

  function drawNow() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    state.width = rect.width;
    state.height = rect.height;
    const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#090a0e';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawAxes();

    const records = state.data.records || [];
    const points = records
      .filter(record => ['value', 'momentum', 'quality'].every(key => isAvailableScore(record.scores?.[key])))
      .map(record => ({
        record,
        x: Number(record.scores.value.score),
        y: Number(record.scores.momentum.score),
        z: Number(record.scores.quality.score),
        low: isAvailableScore(record.scores.low_volatility) ? Number(record.scores.low_volatility.score) : null
      }))
      .map(point => ({ ...point, p: project(point.x, point.y, point.z) }))
      .sort((a, b) => a.p.depth - b.p.depth);
    state.points = points;

    for (const point of points) {
      const active = state.hovered?.record.ticker === point.record.ticker;
      const radius = active ? 9 : 6.5;
      ctx.beginPath(); ctx.arc(point.p.x, point.p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = parulaColor(point.low); ctx.fill();
      ctx.strokeStyle = active ? '#ffffff' : 'rgba(226,239,250,.82)';
      ctx.lineWidth = active ? 2.2 : 1; ctx.stroke();
    }

    if (state.hovered) {
      const point = state.hovered;
      const base = project(point.x, point.y, -3);
      const xEnd = project(point.x, -3, -3);
      const yEnd = project(-3, point.y, -3);
      const zEnd = project(-3, -3, point.z);
      ctx.save(); ctx.strokeStyle = 'rgba(238,246,255,.82)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      for (const [a, b] of [[point.p, base], [base, xEnd], [base, yEnd], [base, zEnd]]) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(point.p.x, point.p.y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.25; ctx.stroke(); ctx.restore();
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e4ebf2'; ctx.font = '600 17px Inter,-apple-system,sans-serif';
    ctx.fillText('LQ45 Factor Zoo · descriptive cross-sectional scores', 22, 28);
    ctx.font = '600 13px Inter,-apple-system,sans-serif'; ctx.fillStyle = '#c5d0dc';
    ctx.fillText(`Current snapshot · IHSG reference date ${state.data.as_of.price} · ${points.length} plotted issuers of ${state.data.universe.count}`, 22, 49);
  }

  function draw() {
    if (state.drawing) return;
    state.drawing = true;
    requestAnimationFrame(() => { state.drawing = false; drawNow(); });
  }

  function showTooltip(point, x, y) {
    if (!point) { tooltip.hidden = true; return; }
    const record = point.record;
    const components = record.components;
    const scores = record.scores;
    const quality = record.data_quality || {};
    const peerGroup = record.peer_group === 'non_financial' ? 'non-financial' : (record.peer_group || 'unclassified');
    tooltip.textContent = `${record.ticker} · ${record.company}\n` +
      `${record.sector || 'Sector unavailable'} · ${record.sub_sector || 'Sub-sector unavailable'} · ${peerGroup} peers\n` +
      `IHSG reference: ${state.data.as_of.price} · issuer prices: ${quality.daily_coverage_start || '—'}–${quality.daily_coverage_end || '—'} (${quality.daily_observation_count ?? '—'} closes; ${quality.aligned_ihsg_returns ?? '—'} aligned IHSG returns) · report as of: ${record.report_as_of || '—'}\n` +
      `Snapshot quality: daily ${quality.daily || 'unknown'} · company report ${quality.company_report || 'unknown'}\n` +
      `\n` + factorBlock('Value (X)', scores.value, [
        componentLine('Earnings yield', components.earnings_yield, percentInput),
        componentLine('Dividend yield', components.dividend_yield, percentInput)
      ]) +
      `\n\n` + factorBlock('Momentum (Y)', scores.momentum, [
        componentLine('12–1 return', components.momentum_12_1, percentInput),
        componentLine('Close / SMA200 − 1', components.price_vs_ma200, percentInput)
      ]) +
      `\n\n` + factorBlock('Quality (Z)', scores.quality, [
        componentLine('ROE', components.roe, ratioInput),
        componentLine('Debt-to-equity (reversed)', components.debt_to_equity, ratioInput)
      ]) +
      `\n\n` + factorBlock('Low Volatility (color)', scores.low_volatility, [
        componentLine('IHSG beta (reversed)', components.beta_ihsg, value => `${ratioInput(value)}×`),
        componentLine('Daily residual volatility (reversed)', components.idiosyncratic_volatility, percentInput)
      ]) +
      `\n\nScoring: P5/P95 winsorization → population z-score, clipped to ±3; factor score = arithmetic mean of component z-scores. Lower DER, beta, and residual volatility score higher. Quality peers are standardized within the financial or non-financial group. ROE and DER are shown in source report ratio units; residual volatility is daily.`;
    const tooltipWidth = Math.min(420, Math.max(260, state.width - 28));
    const maxLeft = Math.max(8, state.width - tooltipWidth - 8);
    tooltip.style.width = `${tooltipWidth}px`;
    tooltip.style.maxHeight = `${Math.max(160, state.height - 16)}px`;
    tooltip.hidden = false;
    const tooltipHeight = tooltip.offsetHeight;
    const maxTop = Math.max(8, state.height - tooltipHeight - 8);
    tooltip.style.left = `${Math.max(8, Math.min(maxLeft, x + 14))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(maxTop, y + 14))}px`;
  }

  function renderLeaderboards(data) {
    const root = document.getElementById('leaderboards');
    root.innerHTML = Object.entries(FACTOR_LABELS).map(([factor, title]) => {
      const rows = (data.leaderboards?.[factor] || []).slice(0, 5);
      const list = rows.length
        ? `<ol>${rows.map(row => `<li><b>${escapeText(row.ticker)}</b> <span>${factorScoreLabel(row.score)}σ · ${Number(row.components)}/2 inputs</span></li>`).join('')}</ol>`
        : '<p class="empty-board">No complete scores meet the requirements.</p>';
      return `<article class="leaderboard-card"><h3>${escapeText(title)}</h3>${list}</article>`;
    }).join('');
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function setFollow(enabled) {
    state.followMatlab = enabled;
    if (enabled) pollMatlabView();
    else stopPolling();
  }

  async function pollMatlabView() {
    if (!state.followMatlab) return;
    try {
      const url = new URL(MATLAB_VIEW_URL);
      url.searchParams.set('t', String(Date.now()));
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const view = await response.json();
      if (view.schema_version !== state.data.schema_version || view.status === 'SYNC_ERROR') {
        throw new Error(view.error || 'MATLAB view schema does not match.');
      }
      if (!Number.isFinite(Number(view.azimuth)) || !Number.isFinite(Number(view.elevation))) {
        throw new Error('MATLAB angles must be valid numbers.');
      }
      if (view.status !== 'WAITING_FOR_MATLAB' && view.artifact_fingerprint === state.data.artifact_fingerprint) {
        const key = `${Number(view.azimuth).toFixed(2)}:${Number(view.elevation).toFixed(2)}`;
        if (key !== state.lastMatlabView) {
          state.lastMatlabView = key;
          state.view.yaw = Number(view.azimuth) * Math.PI / 180;
          state.view.pitch = Math.max(-0.9, Math.min(1.1, Number(view.elevation) * Math.PI / 180));
          draw();
        }
      }
    } catch (_) {}
  }

  function startPolling() {
    if (state.pollTimer) return;
    pollMatlabView();
    state.pollTimer = window.setInterval(pollMatlabView, 250);
  }

  function stopPolling() {
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function initInteractions() {
    canvas.addEventListener('pointerdown', event => {
      tooltip.hidden = true;
      state.hovered = null;
      state.drag = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      if (state.followMatlab) setFollow(false);
    });

    canvas.addEventListener('pointermove', event => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (state.drag) {
        state.view.yaw += (event.clientX - state.drag.x) * 0.008;
        state.view.pitch = Math.max(-0.9, Math.min(1.1, state.view.pitch + (event.clientY - state.drag.y) * 0.008));
        state.drag = { x: event.clientX, y: event.clientY };
        draw();
        return;
      }
      let nearest = null, distance = 20;
      for (const point of state.points) {
        const nextDistance = Math.hypot(point.p.x - x, point.p.y - y);
        if (nextDistance < distance) { nearest = point; distance = nextDistance; }
      }
      if (nearest !== state.hovered) { state.hovered = nearest; draw(); }
      showTooltip(nearest, x, y);
    });
    canvas.addEventListener('pointerup', () => { state.drag = null; });
    canvas.addEventListener('pointercancel', () => { state.drag = null; });
    canvas.addEventListener('pointerleave', () => { if (!state.drag) tooltip.hidden = true; });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      if (state.followMatlab) setFollow(false);
      state.view.zoom = Math.max(0.65, Math.min(1.8, state.view.zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
      draw();
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const step = 0.08;
      if (event.key === 'ArrowLeft') state.view.yaw -= step;
      else if (event.key === 'ArrowRight') state.view.yaw += step;
      else if (event.key === 'ArrowUp') state.view.pitch = Math.min(1.1, state.view.pitch + step);
      else if (event.key === 'ArrowDown') state.view.pitch = Math.max(-0.9, state.view.pitch - step);
      else if (event.key === '+' || event.key === '=') state.view.zoom = Math.min(1.8, state.view.zoom * 1.1);
      else if (event.key === '-') state.view.zoom = Math.max(0.65, state.view.zoom * 0.9);
      else if (event.key === 'Escape') { tooltip.hidden = true; state.hovered = null; draw(); return; }
      else return;
      event.preventDefault();
      if (state.followMatlab) setFollow(false);
      draw();
    });

    window.addEventListener('resize', draw);
  }

  async function loadDemo() {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.records) || !data.as_of?.price || !data.artifact_fingerprint) {
        throw new Error('The data dump schema is incomplete.');
      }
      state.data = data;
      renderLeaderboards(data);
      loadState.hidden = true;
      initInteractions();
      draw();
      if (new URLSearchParams(location.search).get('follow') === 'matlab') {
        state.followMatlab = true;
        startPolling();
      }
    } catch (error) {
      loadState.textContent = `Factor Zoo data could not be loaded (${error.message}). Serve this folder locally, for example: python3 -m http.server 8000`;
      loadState.hidden = false;
    }
  }

  window.addEventListener('pagehide', stopPolling, { once: true });
  loadDemo();
})();
