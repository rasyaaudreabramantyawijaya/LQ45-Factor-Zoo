(function () {
  'use strict';

  const ROOT = new URL('../', document.currentScript.src);
  const DATA_URL = new URL('data/demo-universe.json', ROOT);
  const SAMPLE_INPUT_URL = new URL('data/demo-factor-inputs.csv', ROOT);
  const MATLAB_VIEW_URL = new URL('data/factor-zoo-view.json', ROOT);
  const RESET_VIEW = { yaw: -37.5 * Math.PI / 180, pitch: 28 * Math.PI / 180, zoom: 1 };
  const canvas = document.getElementById('factor-zoo-canvas');
  const ctx = canvas.getContext('2d');
  const frame = canvas.closest('.chart-frame');
  const tooltip = frame.querySelector('.tooltip');
  const loadState = document.getElementById('load-state');
  const fileInput = document.getElementById('data-file-input');
  const importButton = document.getElementById('data-import-button');
  const dataHelpButton = document.getElementById('data-help-button');
  const dataHelp = document.getElementById('data-help');
  const importStatus = document.getElementById('import-status');
  let interactionsReady = false;
  let importedUserData = false;
  let importInProgress = false;
  let importSequence = 0;
  let importStatusTimer = null;
  const state = {
    data: null,
    axes: window.FactorAxes.getSelection(),
    rankLimit: '5',
    view: { ...RESET_VIEW },
    width: 0,
    height: 0,
    points: [],
    hovered: null,
    drag: null,
    drawing: false,
    tutorialFocus: false,
    followMatlab: false,
    lastMatlabView: '',
    pollTimer: null
  };

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
    const scale = Math.min(state.width * 0.31, state.height * 0.29) * state.view.zoom;
    return {
      x: state.width * 0.47 + rx * scale * perspective,
      y: state.height * 0.50 - vertical * scale * perspective,
      depth
    };
  }

  function parulaColor(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '#778493';
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
    const textScale = Math.max(1, Math.min(1.35, state.width / 1440));
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

    ctx.font = `${Math.round(14 * textScale)}px Inter,-apple-system,sans-serif`;
    ctx.fillStyle = '#dce5ed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tick of ticks) {
      let point = project(tick, -3, -3); ctx.fillText(String(tick), point.x, point.y + 15);
      point = project(-3, tick, -3); ctx.fillText(String(tick), point.x - 16, point.y + 2);
      point = project(-3, -3, tick); ctx.textAlign = 'right'; ctx.fillText(String(tick), point.x - 10, point.y); ctx.textAlign = 'center';
    }

    ctx.font = `600 ${Math.round(15 * textScale)}px Inter,-apple-system,sans-serif`;
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
      ctx.fillText(label, 0, 0, Math.max(100, Math.hypot(b.x - a.x, b.y - a.y) - 16));
      ctx.restore();
    };
    axisLabel(`${window.FactorAxes.getOption(state.axes.x).short} (X)`, [-3, -3, -3], [3, -3, -3], 22);
    axisLabel(`${window.FactorAxes.getOption(state.axes.y).short} (Y)`, [-3, -3, -3], [-3, 3, -3], 22);
    axisLabel(`${window.FactorAxes.getOption(state.axes.z).short} (Z)`, [-3, -3, -3], [-3, -3, 3], 22);
  }

  function drawNow() {
    // Interactions remain available after a failed demo load so a user can
    // import data; a resize or keyboard event must not dereference null data.
    if (!state.data) return;
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
    const points = window.FactorAxes.mapPoints(records, state.axes)
      .map(point => ({ ...point, p: project(point.x, point.y, point.z) }))
      .sort((a, b) => a.p.depth - b.p.depth);
    state.points = points;
    // A redraw recreates projected points. Keep the highlighted issuer tied to
    // the new projection instead of drawing its crosshair at stale coordinates.
    if (state.hovered) state.hovered = points.find(point => point.record.ticker === state.hovered.record.ticker) || null;
    const axisNames = ['x', 'y', 'z'].map(axis => `${axis.toUpperCase()}: ${window.FactorAxes.getOption(state.axes[axis]).short}`).join(' · ');
    const missingColor = points.filter(point => point.low == null).length;
    document.getElementById('axis-status').textContent = `${axisNames} · ${points.length} of ${records.length} issuers plotted · ${missingColor} gray (Low Volatility unavailable)`;
    canvas.setAttribute('aria-label', `3D factor scatter. ${axisNames}. Color is locked to Low Volatility; gray means unavailable. ${points.length} issuers plotted.`);
    if (!points.length) {
      ctx.save(); ctx.textAlign = 'center'; ctx.font = '16px Inter,-apple-system,sans-serif'; ctx.fillStyle = '#d4e0ea';
      ctx.fillText('No issuer has complete scores for the selected axes.', state.width / 2, state.height * 0.9);
      ctx.restore();
    }

    for (const point of points) {
      const active = state.hovered?.record.ticker === point.record.ticker;
      const radius = active ? (state.tutorialFocus ? 20 : 12) : 8;
      if (active && state.tutorialFocus) {
        ctx.save();
        ctx.shadowColor = '#55d7e8';
        ctx.shadowBlur = 22;
      }
      ctx.beginPath(); ctx.arc(point.p.x, point.p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = parulaColor(point.low); ctx.fill();
      ctx.strokeStyle = active ? '#ffffff' : 'rgba(226,239,250,.82)';
      ctx.lineWidth = active ? 2.2 : 1; ctx.stroke();
      if (active && state.tutorialFocus) ctx.restore();
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
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(point.p.x, point.p.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.25; ctx.stroke(); ctx.restore();
    }

    const textScale = Math.max(1, Math.min(1.35, state.width / 1440));
    const headingWidth = Math.max(120, state.width - 190);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e4ebf2'; ctx.font = `600 ${Math.round(21 * textScale)}px Inter,-apple-system,sans-serif`;
    ctx.fillText(`${state.data.universe.name || 'Factor'} Factor Zoo · descriptive cross-sectional scores`, 22, 32, headingWidth);
    ctx.font = `600 ${Math.round(15 * textScale)}px Inter,-apple-system,sans-serif`; ctx.fillStyle = '#c5d0dc';
    const reference = state.data.as_of.benchmark_date
      ? `IHSG reference date ${state.data.as_of.benchmark_date}`
      : `Dataset reference date ${state.data.as_of.price || '—'} · IHSG date not provided`;
    ctx.fillText(`${state.data.dataset_label || 'Current snapshot'} · ${reference} · ${points.length} plotted issuers of ${state.data.universe.count}`, 22, 57, headingWidth);
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
    const componentMarkup = (label, component, format, natural = false) => {
      const option = window.FactorAxes.getOption(natural);
      const componentZ = component?.z_score == null ? null : Number(component.z_score) * (option?.baseReversed ? -1 : 1);
      const available = component?.status === 'AVAILABLE' && component.value != null;
      const details = available
        ? `${format(component.value)} · z ${componentZ == null ? 'not scored' : signedFactorScore(componentZ)} · n=${component.peer_count ?? '—'} peers`
        : `Unavailable · ${component?.status || 'NO DATA'}`;
      return `<div class="tooltip-component"><span class="tooltip-component-label">${escapeText(label)}</span><span class="tooltip-component-value">${escapeText(details)}</span></div>`;
    };
    const factorMarkup = (label, score, items, rankNote = '') => {
      const scoreText = signedFactorScore(score?.score);
      const status = score?.status || 'UNAVAILABLE';
      return `<section class="tooltip-factor"><div class="tooltip-factor-heading"><strong>${escapeText(label)}</strong><span>${escapeText(scoreText)} · ${escapeText(status)}</span></div>${items.join('')}${rankNote ? `<p class="tooltip-rank-note">${escapeText(rankNote)}</p>` : ''}</section>`;
    };
    const qualityLine = `Daily: ${quality.daily || 'unknown'} · company report: ${quality.company_report || 'unknown'}`;
    const componentInfo = {
      earnings_yield: ['Earnings yield', percentInput],
      dividend_yield: ['Dividend yield', percentInput],
      momentum_12_1: ['12–1 return', percentInput],
      price_vs_ma200: ['Close / SMA200 − 1', percentInput],
      roe: ['ROE', ratioInput],
      debt_to_equity: ['Debt-to-equity', ratioInput],
      beta_ihsg: ['IHSG beta', value => `${ratioInput(value)}×`],
      idiosyncratic_volatility: ['Daily residual volatility', percentInput]
    };
    const factorInputs = {
      'factor:value': ['earnings_yield', 'dividend_yield'],
      'factor:momentum': ['momentum_12_1', 'price_vs_ma200'],
      'factor:quality': ['roe', 'debt_to_equity']
    };
    function axisCard(axis) {
      const option = window.FactorAxes.getOption(state.axes[axis]);
      const ids = option.kind === 'factor' ? factorInputs[option.id] : [option.id];
      const items = ids.map(id => {
        const [label, format] = componentInfo[id];
        const reversed = option.kind === 'factor' && id === 'debt_to_equity';
        return componentMarkup(`${label}${reversed ? ' (reversed)' : ''}`, components[id], format, option.kind === 'component' ? id : false);
      });
      const direction = window.FactorAxes.defaultRankDirection(option.id);
      const rankingNote = direction === 'lower'
        ? 'Lower is better for this comparison. The axis score above is unchanged; its sign is reversed only in the leaderboard.'
        : 'Higher is better for this comparison. The axis score above is unchanged in the leaderboard.';
      return factorMarkup(`${axis.toUpperCase()} · ${option.short}`, {score: point[axis], status: 'AVAILABLE'}, items, rankingNote);
    }
    tooltip.innerHTML =
      `<header class="tooltip-title"><strong>${escapeText(record.ticker)} · ${escapeText(record.company || 'Company unavailable')}</strong>` +
      `<span>${escapeText(record.sector || 'Sector unavailable')} · ${escapeText(record.sub_sector || 'Sub-sector unavailable')} · ${escapeText(peerGroup)} peers</span></header>` +
      `<div class="tooltip-metadata"><p><strong>Market reference</strong><br>IHSG ${escapeText(state.data.as_of.benchmark_date || 'date not provided')} · prices ${escapeText(quality.daily_coverage_start || '—')}–${escapeText(quality.daily_coverage_end || '—')}</p>` +
      `<p><strong>Price coverage</strong><br>${escapeText(quality.daily_observation_count ?? '—')} closes · ${escapeText(quality.aligned_ihsg_returns ?? '—')} aligned IHSG returns</p>` +
      `<p><strong>Report as of</strong><br>${escapeText(record.report_as_of || '—')}</p>` +
      `<p><strong>Source status</strong><br>${escapeText(qualityLine)}</p></div>` +
      `<div class="tooltip-factor-grid">` +
      ['x', 'y', 'z'].map(axisCard).join('') +
      factorMarkup('Low Volatility (color)', scores.low_volatility, [
        componentMarkup('IHSG beta (reversed)', components.beta_ihsg, value => `${ratioInput(value)}×`),
        componentMarkup('Daily residual volatility (reversed)', components.idiosyncratic_volatility, percentInput)
      ], 'Higher is better for this comparison. The color score is already oriented and is not reversed again for ranking.') +
      `</div><p class="tooltip-method"><strong>Scoring:</strong> P5/P95 winsorization → population z-score, clipped to ±3; factor score is the mean of component z-scores. Components and axis scores above use their original displayed direction. For a lower-is-better measure, the leaderboard reverses the axis score; already-oriented factor and color scores are not reversed again. These directions describe a comparison, not proven investment quality. Quality peers are standardized within financial or non-financial groups. Residual volatility is daily.</p>`;
    const tooltipWidth = Math.min(920, Math.max(300, state.width - 32));
    const maxLeft = Math.max(8, state.width - tooltipWidth - 8);
    tooltip.style.width = `${tooltipWidth}px`;
    tooltip.style.maxHeight = `${Math.max(160, state.height - 16)}px`;
    tooltip.hidden = false;
    const tooltipHeight = tooltip.offsetHeight;
    const maxTop = Math.max(8, state.height - tooltipHeight - 8);
    tooltip.style.left = `${Math.max(8, Math.min(maxLeft, x + 14))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(maxTop, y + 14))}px`;
  }

  const AXIS_METHODS = {
    'factor:value': ['Earnings yield = 1 / positive forward P/E (or supplied yield)', 'Dividend yield = trailing 12-month yield'],
    'factor:momentum': ['12–1 return = close[t−21] / close[t−252] − 1', 'SMA200 distance = close[t] / SMA200[t] − 1'],
    'factor:quality': ['Return on equity (ROE)', 'Debt-to-equity (DER), direction reversed'],
    earnings_yield: ['Earnings yield = 1 / positive forward P/E (or supplied yield)'],
    dividend_yield: ['Trailing 12-month dividend yield'],
    momentum_12_1: ['12–1 return = close[t−21] / close[t−252] − 1'],
    price_vs_ma200: ['SMA200 distance = close[t] / SMA200[t] − 1'],
    roe: ['Return on equity (ROE)'],
    debt_to_equity: ['Debt-to-equity (DER), natural direction'],
    beta_ihsg: ['IHSG beta from date-aligned daily returns, natural direction'],
    idiosyncratic_volatility: ['Daily OLS residual volatility, natural direction']
  };

  function renderMethods() {
    const root = document.getElementById('factor-method-grid');
    const colors = { x: 'value-method', y: 'momentum-method', z: 'quality-method' };
    const cards = ['x', 'y', 'z'].map(axis => {
      const option = window.FactorAxes.getOption(state.axes[axis]);
      const formulas = AXIS_METHODS[option.id].map(formula => `<code>${escapeText(formula)}</code>`).join('<br>');
      return `<article class="method-card ${colors[axis]}"><h3><span class="axis-tag">${axis.toUpperCase()}</span> ${escapeText(option.short)}</h3><p class="method-formula">${formulas}</p><p>${escapeText(option.detail)}</p></article>`;
    });
    cards.push('<article class="method-card lowvol-method"><h3><span class="axis-tag">Color</span> Low Volatility</h3><p class="method-formula"><code>IHSG beta, direction reversed</code><br><code>Daily OLS residual volatility, direction reversed</code></p><p>Mean of the two component scores. Estimated from issuer and IHSG daily returns aligned by date; at least 126 aligned returns are required.</p></article>');
    root.innerHTML = cards.join('');
  }

  function renderLeaderboards(data) {
    const root = document.getElementById('leaderboards');
    const records = Array.isArray(data.records) ? data.records : [];
    const points = window.FactorAxes.mapPoints(records, state.axes);
    const universeName = data.universe?.name || 'Current';
    const asOf = data.as_of?.price || 'date unavailable';
    document.getElementById('leaderboard-title').textContent = `${universeName} axis leaders`;
    const subtitle = document.getElementById('leaderboard-subtitle');
    subtitle.textContent = `${points.length} plotted of ${records.length} issuers · ${asOf}`;
    if (!document.getElementById('rank-limit')) {
      const label = document.createElement('label');
      label.className = 'rank-controls';
      label.innerHTML = 'Show <select id="rank-limit" aria-label="Number of leaderboard entries"><option value="5">Top 5</option><option value="10">Top 10</option><option value="15">Top 15</option><option value="all">All plotted</option></select>';
      subtitle.after(label);
      label.querySelector('select').addEventListener('change', event => {
        state.rankLimit = event.target.value;
        if (state.data) renderLeaderboards(state.data);
      });
    }
    const boards = ['x', 'y', 'z'].map(axis => ({
      key: axis, label: `${axis.toUpperCase()} · ${window.FactorAxes.getOption(state.axes[axis]).short}`,
      direction: window.FactorAxes.defaultRankDirection(state.axes[axis])
    }));
    boards.push({ key: 'low', label: 'Color · Low Volatility', direction: 'higher' });
    root.innerHTML = boards.map(board => {
      const eligible = points.filter(point => point[board.key] != null && Number.isFinite(Number(point[board.key])))
        .map(point => ({ point, rank: window.FactorAxes.rankScore(point[board.key], board.direction) }))
        .sort((a, b) => b.rank - a.rank || String(a.point.record.ticker).localeCompare(String(b.point.record.ticker)));
      const rows = state.rankLimit === 'all' ? eligible : eligible.slice(0, Number(state.rankLimit));
      const list = rows.length
        ? `<ol>${rows.map(({point, rank}) => `<li><b>${escapeText(point.record.ticker)}</b> <span>${factorScoreLabel(rank)}σ</span></li>`).join('')}</ol>`
        : '<p class="empty-board">No eligible plotted issuers for this score.</p>';
      const direction = board.direction === 'lower'
        ? '<p class="rank-direction">Lower is better · ranking score is reversed</p>'
        : '<p class="rank-direction">Higher is better · ranking score is unchanged</p>';
      return `<article class="leaderboard-card"><h3>${escapeText(board.label)}</h3>${direction}<p class="rank-count">Showing ${rows.length} of ${eligible.length} eligible plotted</p>${list}</article>`;
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

  function setImportStatus(message, kind = '') {
    window.clearTimeout(importStatusTimer);
    importStatus.textContent = message;
    importStatus.dataset.kind = kind;
    importStatus.hidden = !message;
    if (kind === 'success') importStatusTimer = window.setTimeout(() => { importStatus.hidden = true; }, 9000);
  }

  function updateDataset(data) {
    state.data = data;
    state.hovered = null;
    tooltip.hidden = true;
    renderMethods();
    renderLeaderboards(data);
    draw();
  }

  function importSummary(data) {
    const count = data.records.length;
    const plotted = window.FactorAxes.mapPoints(data.records, state.axes).length;
    const complete = Object.fromEntries(['value', 'quality', 'momentum', 'low_volatility'].map(factor => [
      factor, data.records.filter(record => record.scores[factor]?.status === 'AVAILABLE').length
    ]));
    return `Recalculated ${count} issuers · ${plotted} plotted · complete scores V ${complete.value} / Q ${complete.quality} / M ${complete.momentum} / LV ${complete.low_volatility}.`;
  }

  async function importFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const sequence = ++importSequence;
    importInProgress = true;
    setImportStatus('Reading local files and recalculating factor scores…');
    try {
      const tables = await window.FactorData.readFiles(selected);
      const names = selected.map(file => file.name).join(', ');
      const data = window.FactorData.buildFromTables(tables, { label: `User upload · ${names}` });
      if (sequence !== importSequence) return;
      data.provider = 'User-uploaded local files';
      data.dataset_label = `User upload · ${names}`;
      data.source_class = 'derived_metric';
      importedUserData = true;
      stopPolling();
      state.followMatlab = false;
      updateDataset(data);
      loadState.hidden = true;
      ensureInteractions();
      setImportStatus(importSummary(data), 'success');
    } catch (error) {
      if (sequence === importSequence) setImportStatus(`Import failed: ${error.message}`, 'error');
    } finally {
      if (sequence === importSequence) {
        importInProgress = false;
        fileInput.value = '';
        if (!state.data && !importedUserData) loadDemo();
      }
    }
  }

  function initDataInput() {
    fileInput.addEventListener('change', event => importFiles(event.target.files));
    importButton.addEventListener('click', () => fileInput.click());
    dataHelpButton.addEventListener('click', () => {
      const open = dataHelp.hidden;
      dataHelp.hidden = !open;
      dataHelpButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('pointerdown', event => {
      if (dataHelp.hidden || dataHelp.contains(event.target) || dataHelpButton.contains(event.target)) return;
      dataHelp.hidden = true;
      dataHelpButton.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || dataHelp.hidden) return;
      dataHelp.hidden = true;
      dataHelpButton.setAttribute('aria-expanded', 'false');
      dataHelpButton.focus();
    });
    const carriesFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    frame.addEventListener('dragenter', event => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      frame.classList.add('is-file-dragging');
    });
    frame.addEventListener('dragover', event => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    frame.addEventListener('dragleave', event => {
      if (event.relatedTarget && frame.contains(event.relatedTarget)) return;
      frame.classList.remove('is-file-dragging');
    });
    frame.addEventListener('drop', event => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      frame.classList.remove('is-file-dragging');
      importFiles(event.dataTransfer?.files);
    });
  }

  function ensureInteractions() {
    if (interactionsReady) return;
    interactionsReady = true;
    initInteractions();
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
      let nearest = null, distance = 24;
      for (const point of state.points) {
        const nextDistance = Math.hypot(point.p.x - x, point.p.y - y);
        if (nextDistance < distance) { nearest = point; distance = nextDistance; }
      }
      if (nearest !== state.hovered) { state.hovered = nearest; draw(); }
      showTooltip(nearest, x, y);
    });
    canvas.addEventListener('pointerup', () => { state.drag = null; });
    canvas.addEventListener('pointercancel', () => { state.drag = null; });
    canvas.addEventListener('pointerleave', () => {
      if (state.drag || state.tutorialFocus) return;
      tooltip.hidden = true;
      state.hovered = null;
      draw();
    });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      tooltip.hidden = true;
      state.hovered = null;
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
      tooltip.hidden = true;
      state.hovered = null;
      if (state.followMatlab) setFollow(false);
      draw();
    });

    window.addEventListener('resize', () => {
      if (!state.tutorialFocus) { tooltip.hidden = true; state.hovered = null; }
      draw();
    });
  }

  window.FactorZooTourHooks = {
    showSamplePoint() {
      if (!state.data) return null;
      state.tutorialFocus = true;
      drawNow();
      const ticker = state.points.some(point => point.record.ticker === 'BBCA') ? 'BBCA' : null;
      state.hovered = state.points.find(point => point.record.ticker === ticker) || state.points[0] || null;
      if (!state.hovered) return null;
      drawNow();
      const point = state.points.find(item => item.record.ticker === state.hovered.record.ticker);
      const frameRect = frame.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const x = canvasRect.left - frameRect.left + point.p.x;
      const y = canvasRect.top - frameRect.top + point.p.y;
      showTooltip(point, x, y);
      return {
        ticker: point.record.ticker,
        pointRect: {
          left: frameRect.left + x - 17,
          top: frameRect.top + y - 17,
          width: 34,
          height: 34,
          right: frameRect.left + x + 17,
          bottom: frameRect.top + y + 17
        },
        tooltipRect: tooltip.getBoundingClientRect(),
        frameRect
      };
    },
    clearSamplePoint() {
      state.tutorialFocus = false;
      state.hovered = null;
      tooltip.hidden = true;
      draw();
    }
  };

  async function loadDemo() {
    try {
      let sourceSnapshot = null;
      let csvText = '';
      try {
        const [response, inputResponse] = await Promise.all([
          fetch(DATA_URL, { cache: 'no-store' }), fetch(SAMPLE_INPUT_URL, { cache: 'no-store' })
        ]);
        if (!response.ok || !inputResponse.ok) throw new Error(`HTTP ${response.status}/${inputResponse.status}`);
        sourceSnapshot = await response.json();
        csvText = await inputResponse.text();
        if (!Array.isArray(sourceSnapshot.records) || !sourceSnapshot.as_of?.price || !sourceSnapshot.artifact_fingerprint) {
          throw new Error('The data dump schema is incomplete.');
        }
      } catch (loadError) {
        const bootstrap = window.FACTOR_ZOO_BOOTSTRAP;
        if (!bootstrap?.csv || !bootstrap?.meta) throw loadError;
        csvText = bootstrap.csv;
        sourceSnapshot = bootstrap.meta;
      }
      if (importedUserData || importInProgress) return;
      const sampleTable = window.FactorData.parseCsv(csvText, 'demo-factor-inputs.csv');
      const data = window.FactorData.buildFromTables([sampleTable], {
        demo: true, label: 'Bundled demo snapshot · locally recalculated', asOf: sourceSnapshot.as_of.price
      });
      data.schema_version = sourceSnapshot.schema_version;
      data.artifact_fingerprint = sourceSnapshot.artifact_fingerprint;
      data.source_artifact_fingerprint = sourceSnapshot.source_artifact_fingerprint;
      data.provider = sourceSnapshot.provider;
      data.dataset_label = 'Offline demo sample · bundled snapshot · scores recalculated locally';
      data.universe = { ...sourceSnapshot.universe, ...data.universe, name: 'LQ45', count: sourceSnapshot.universe.count };
      data.as_of = { ...sourceSnapshot.as_of, benchmark_date: sourceSnapshot.as_of.price };
      if (Array.isArray(sourceSnapshot.records)) {
        const sourceRecords = new Map(sourceSnapshot.records.map(record => [record.ticker, record]));
        for (const record of data.records) {
          const original = sourceRecords.get(record.ticker);
          if (original) {
            record.data_quality = { ...record.data_quality, ...original.data_quality };
            record.peer_group = original.peer_group;
            record.report_as_of = original.report_as_of;
          }
        }
      }
      updateDataset(data);
      loadState.hidden = true;
      ensureInteractions();
      if (new URLSearchParams(location.search).get('follow') === 'matlab') {
        state.followMatlab = true;
        startPolling();
      }
    } catch (error) {
      if (state.data) return;
      loadState.textContent = `Factor Zoo data could not be loaded (${error.message}). Serve this folder locally, for example: python3 -m http.server 8000`;
      loadState.hidden = false;
      setImportStatus(`Bundled data could not be loaded: ${error.message}`, 'error');
      ensureInteractions();
    }
  }

  window.addEventListener('pagehide', stopPolling, { once: true });
  window.FactorAxes.onChange = axes => {
    state.axes = axes;
    state.hovered = null;
    tooltip.hidden = true;
    renderMethods();
    if (state.data) { renderLeaderboards(state.data); draw(); }
  };
  initDataInput();
  loadDemo();
})();
