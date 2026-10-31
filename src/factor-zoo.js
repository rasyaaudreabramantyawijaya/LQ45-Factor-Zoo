(function () {
  'use strict';

  var FACTORS = {
    value: { label: 'Value', components: ['earningsYield', 'dividendYield'] },
    quality: { label: 'Quality', components: ['roe', 'debtToEquity'] },
    momentum: { label: 'Momentum', components: ['momentum12_1', 'aboveSma200'] },
    lowVol: { label: 'Low Vol', components: ['beta', 'residualVolatility'] }
  };
  var METRICS = {
    earningsYield: { label: 'Earnings yield', format: 'percent', higherBetter: true },
    dividendYield: { label: 'Trailing dividend yield', format: 'percent', higherBetter: true },
    roe: { label: 'Return on equity', format: 'percent', higherBetter: true },
    debtToEquity: { label: 'Debt-to-equity', format: 'multiple', higherBetter: false },
    momentum12_1: { label: '12–1 month momentum', format: 'percent', higherBetter: true },
    aboveSma200: { label: 'Distance from SMA200', format: 'percent', higherBetter: true },
    beta: { label: 'Market beta', format: 'multiple', higherBetter: false },
    residualVolatility: { label: 'Residual volatility', format: 'percent', higherBetter: false }
  };
  var state = {
    issuers: [],
    scores: {},
    selected: null,
    hovered: null,
    yaw: -0.72,
    pitch: 0.43,
    zoom: 1,
    dragging: false,
    dragMoved: false,
    lastX: 0,
    lastY: 0,
    pointerX: 0,
    pointerY: 0,
    plot: [],
    dpr: 1,
    width: 0,
    height: 0,
    axes: { x: 'momentum', y: 'value', z: 'quality' },
    group: 'all',
    query: ''
  };

  var canvas = document.getElementById('factor-chart');
  var ctx = canvas.getContext('2d');
  var panel = document.getElementById('issuer-panel');
  var search = document.getElementById('issuer-search');
  var groupFilter = document.getElementById('group-filter');
  var scoreRows = document.getElementById('score-rows');
  var scatterView = document.getElementById('scatter-view');
  var scorecardView = document.getElementById('scorecard-view');
  var scatterTab = document.getElementById('scatter-tab');
  var tableTab = document.getElementById('table-tab');

  function quantile(sorted, p) {
    if (!sorted.length) return NaN;
    if (sorted.length === 1) return sorted[0];
    var position = (sorted.length - 1) * p;
    var lower = Math.floor(position);
    var fraction = position - lower;
    return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
  }

  function mean(values) {
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function scoreComponent(issuers, metricKey, peerGroup) {
    var definition = METRICS[metricKey];
    var candidates = issuers.filter(function (issuer) {
      return Number.isFinite(issuer[metricKey]) && (!peerGroup || issuer.group === peerGroup);
    });
    if (candidates.length < 5) return {};
    var directed = candidates.map(function (issuer) {
      return definition.higherBetter ? issuer[metricKey] : -issuer[metricKey];
    });
    var sorted = directed.slice().sort(function (a, b) { return a - b; });
    var low = quantile(sorted, 0.05);
    var high = quantile(sorted, 0.95);
    var clipped = directed.map(function (value) { return Math.max(low, Math.min(high, value)); });
    var center = mean(clipped);
    var variance = mean(clipped.map(function (value) { return Math.pow(value - center, 2); }));
    var sd = Math.sqrt(variance);
    if (!Number.isFinite(sd) || sd <= 1e-12) return {};
    var result = {};
    candidates.forEach(function (issuer, index) {
      result[issuer.ticker] = Math.max(-3, Math.min(3, (clipped[index] - center) / sd));
    });
    return result;
  }

  function buildScores(issuers) {
    var componentScoreMaps = {};
    Object.keys(METRICS).forEach(function (metricKey) {
      if (metricKey === 'roe' || metricKey === 'debtToEquity') {
        componentScoreMaps[metricKey] = {};
        ['Financial', 'Non-financial'].forEach(function (peerGroup) {
          Object.assign(componentScoreMaps[metricKey], scoreComponent(issuers, metricKey, peerGroup));
        });
      } else {
        componentScoreMaps[metricKey] = scoreComponent(issuers, metricKey, null);
      }
    });
    var scoreMap = {};
    issuers.forEach(function (issuer) {
      scoreMap[issuer.ticker] = {};
      Object.keys(FACTORS).forEach(function (factorKey) {
        var available = FACTORS[factorKey].components.map(function (component) {
          return componentScoreMaps[component][issuer.ticker];
        }).filter(Number.isFinite);
        scoreMap[issuer.ticker][factorKey] = available.length ? mean(available) : null;
      });
    });
    return scoreMap;
  }

  function formatRaw(value, format) {
    if (!Number.isFinite(value)) return 'Not available';
    if (format === 'percent') return (value * 100).toFixed(1) + '%';
    return value.toFixed(2) + '×';
  }

  function scoreColor(value) {
    if (!Number.isFinite(value)) return '#71849d';
    if (value >= 0.6) return '#35d0b2';
    if (value <= -0.6) return '#f27586';
    return '#63a6ff';
  }

  function scoreLabel(value) {
    if (!Number.isFinite(value)) return 'N/A';
    return (value > 0 ? '+' : '') + value.toFixed(2);
  }

  function visibleIssuers() {
    var normalizedQuery = state.query.trim().toLowerCase();
    return state.issuers.filter(function (issuer) {
      var groupMatches = state.group === 'all' || issuer.group === state.group;
      var textMatches = !normalizedQuery || issuer.ticker.toLowerCase().indexOf(normalizedQuery) >= 0 || issuer.company.toLowerCase().indexOf(normalizedQuery) >= 0;
      return groupMatches && textMatches;
    });
  }

  function axesValid() {
    var values = [state.axes.x, state.axes.y, state.axes.z];
    return new Set(values).size === values.length;
  }

  function axisValue(ticker, axis) {
    return state.scores[ticker] ? state.scores[ticker][axis] : null;
  }

  function projectPoint(x, y, z, width, height) {
    var cosYaw = Math.cos(state.yaw);
    var sinYaw = Math.sin(state.yaw);
    var cosPitch = Math.cos(state.pitch);
    var sinPitch = Math.sin(state.pitch);
    var xRot = x * cosYaw - z * sinYaw;
    var zRot = x * sinYaw + z * cosYaw;
    var yRot = y * cosPitch - zRot * sinPitch;
    var depth = y * sinPitch + zRot * cosPitch;
    var unit = Math.min(width * 0.27, height * 0.34) * state.zoom;
    var perspective = 1 + depth * 0.035;
    return {
      x: width * 0.51 + xRot * unit * perspective,
      y: height * 0.51 - yRot * unit * perspective,
      depth: depth,
      radius: 5.7 + Math.max(-1.4, Math.min(2.1, depth * 0.42))
    };
  }

  function toNorm(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-1, Math.min(1, value / 3));
  }

  function drawLine(a, b, color, width, dash) {
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawGrid(width, height) {
    var tick = [-1, -0.5, 0, 0.5, 1];
    var origin = projectPoint(0, 0, 0, width, height);
    var axisX = projectPoint(1.18, 0, 0, width, height);
    var axisY = projectPoint(0, 1.18, 0, width, height);
    var axisZ = projectPoint(0, 0, 1.18, width, height);
    var faint = 'rgba(103,132,160,.15)';
    tick.forEach(function (value) {
      drawLine(projectPoint(-1, value, -1, width, height), projectPoint(1, value, -1, width, height), faint, 1);
      drawLine(projectPoint(value, -1, -1, width, height), projectPoint(value, 1, -1, width, height), faint, 1);
      drawLine(projectPoint(-1, -1, value, width, height), projectPoint(-1, 1, value, width, height), faint, 1);
    });
    drawLine(origin, axisX, 'rgba(151,174,198,.62)', 1.15);
    drawLine(origin, axisY, 'rgba(151,174,198,.62)', 1.15);
    drawLine(origin, axisZ, 'rgba(151,174,198,.62)', 1.15);
    ctx.fillStyle = '#9dafc4';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(FACTORS[state.axes.x].label + '  X', axisX.x + 13, axisX.y + 13);
    ctx.fillText(FACTORS[state.axes.y].label + '  Y', axisY.x - 4, axisY.y - 12);
    ctx.fillText(FACTORS[state.axes.z].label + '  Z', axisZ.x + 1, axisZ.y - 12);
    ctx.fillStyle = '#71849d';
    ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('−3', projectPoint(-1, 0, 0, width, height).x - 2, projectPoint(-1, 0, 0, width, height).y + 15);
    ctx.fillText('+3', axisX.x + 2, axisX.y + 28);
    ctx.textAlign = 'right';
    ctx.fillText('−3', projectPoint(0, -1, 0, width, height).x - 7, projectPoint(0, -1, 0, width, height).y + 3);
    ctx.fillText('+3', axisY.x - 12, axisY.y - 3);
  }

  function drawCanvas() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    state.dpr = window.devicePixelRatio || 1;
    state.width = rect.width;
    state.height = rect.height;
    canvas.width = Math.round(rect.width * state.dpr);
    canvas.height = Math.round(rect.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawGrid(rect.width, rect.height);
    var points = visibleIssuers().filter(function (issuer) {
      return ['x', 'y', 'z'].every(function (axisName) { return Number.isFinite(axisValue(issuer.ticker, state.axes[axisName])); });
    }).map(function (issuer) {
      var projected = projectPoint(
        toNorm(axisValue(issuer.ticker, state.axes.x)),
        toNorm(axisValue(issuer.ticker, state.axes.y)),
        toNorm(axisValue(issuer.ticker, state.axes.z)),
        rect.width,
        rect.height
      );
      projected.issuer = issuer;
      projected.color = scoreColor(axisValue(issuer.ticker, 'lowVol'));
      return projected;
    }).sort(function (a, b) { return a.depth - b.depth; });
    state.plot = points;
    points.forEach(function (point) {
      var isSelected = state.selected === point.issuer.ticker;
      var isHovered = state.hovered === point.issuer.ticker;
      var radius = point.radius + (isSelected || isHovered ? 2 : 0);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = point.color + '18';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = point.color;
      ctx.fill();
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = isSelected ? '#f5f8fc' : 'rgba(229,238,248,.45)';
      ctx.stroke();
      ctx.fillStyle = isHovered || isSelected ? '#f1f5fa' : '#a9bbcf';
      ctx.font = (isHovered || isSelected ? '700 ' : '600 ') + '9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(point.issuer.ticker, point.x, point.y - radius - 7);
    });
    if (state.hovered) drawHoverCard(rect.width, rect.height);
    if (!points.length) drawEmptyState(rect.width, rect.height);
  }

  function drawEmptyState(width, height) {
    ctx.fillStyle = '#91a2b9';
    ctx.textAlign = 'center';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('No issuers match these filters.', width / 2, height / 2);
  }

  function drawHoverCard(width, height) {
    var point = state.plot.find(function (item) { return item.issuer.ticker === state.hovered; });
    if (!point) return;
    var cardWidth = 154;
    var cardHeight = 60;
    var x = Math.min(width - cardWidth - 10, Math.max(10, state.pointerX + 15));
    var y = Math.min(height - cardHeight - 10, Math.max(10, state.pointerY + 12));
    ctx.fillStyle = 'rgba(5,13,22,.95)';
    ctx.strokeStyle = '#2a425b';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, cardWidth, cardHeight, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#eef4fb';
    ctx.textAlign = 'left';
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    ctx.fillText(point.issuer.ticker + ' · ' + point.issuer.group, x + 10, y + 17);
    ctx.fillStyle = '#9fb1c5';
    ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.fillText(FACTORS[state.axes.x].label + ': ' + scoreLabel(axisValue(point.issuer.ticker, state.axes.x)), x + 10, y + 34);
    ctx.fillText(FACTORS[state.axes.y].label + ': ' + scoreLabel(axisValue(point.issuer.ticker, state.axes.y)) + '   ' + FACTORS[state.axes.z].label + ': ' + scoreLabel(axisValue(point.issuer.ticker, state.axes.z)), x + 10, y + 49);
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }


  function renderIssuerPanel(ticker) {
    var issuer = state.issuers.find(function (item) { return item.ticker === ticker; });
    if (!issuer) {
      panel.innerHTML = '<div class="empty-selection"><span class="empty-glyph">◎</span><h3>Select an issuer</h3><p>Hover or click a point in the chart, or select a ticker from the scorecard.</p></div>';
      return;
    }
    var scores = state.scores[ticker];
    var factorHtml = Object.keys(FACTORS).map(function (key) {
      var value = scores[key];
      var width = Number.isFinite(value) ? Math.min(50, Math.abs(value) / 3 * 50) : 0;
      var left = Number.isFinite(value) && value < 0 ? 50 - width : 50;
      var color = scoreColor(value);
      return '<div class="score-row"><span class="score-name">' + FACTORS[key].label + '</span><span class="score-track"><span class="score-fill" style="position:absolute;left:' + left + '%;width:' + width + '%;background:' + color + '"></span></span><strong class="score-value" style="color:' + color + '">' + scoreLabel(value) + '</strong></div>';
    }).join('');
    var rawHtml = Object.keys(METRICS).map(function (key) {
      return '<div class="raw-item"><span>' + METRICS[key].label + '</span><strong>' + formatRaw(issuer[key], METRICS[key].format) + '</strong></div>';
    }).join('');
    panel.innerHTML = '<div class="issuer-detail-head"><div><h3>' + issuer.ticker + '</h3><p>' + issuer.company + '</p><span class="peer-tag">' + issuer.group + ' peer group</span></div><span class="synthetic-tag">SYNTHETIC</span></div><div class="score-list">' + factorHtml + '</div><div class="raw-grid">' + rawHtml + '</div><p class="detail-note">Scores are generated from synthetic example inputs and standardized within this demo cross-section. They do not describe the real issuer.</p>';
  }

  function renderTable() {
    var rows = visibleIssuers().slice().sort(function (a, b) { return a.ticker.localeCompare(b.ticker); });
    scoreRows.innerHTML = rows.map(function (issuer) {
      var selectedClass = state.selected === issuer.ticker ? ' class="selected"' : '';
      var factors = Object.keys(FACTORS).map(function (key) {
        var score = state.scores[issuer.ticker][key];
        var width = Number.isFinite(score) ? Math.min(100, Math.abs(score) / 3 * 100) : 0;
        return '<td><span class="table-score"><b style="color:' + scoreColor(score) + '">' + scoreLabel(score) + '</b><span class="table-bar"><i style="width:' + width + '%;background:' + scoreColor(score) + '"></i></span></span></td>';
      }).join('');
      return '<tr data-ticker="' + issuer.ticker + '"' + selectedClass + '><td><span class="ticker-cell">' + issuer.ticker + '</span><br>' + issuer.company + '</td><td>' + issuer.group + '</td>' + factors + '</tr>';
    }).join('');
    scoreRows.querySelectorAll('tr').forEach(function (row) {
      row.addEventListener('click', function () {
        state.selected = row.getAttribute('data-ticker');
        state.hovered = null;
        renderIssuerPanel(state.selected);
        renderTable();
        drawCanvas();
      });
    });
  }

  function selectTicker(ticker) {
    state.selected = ticker;
    renderIssuerPanel(ticker);
    renderTable();
    drawCanvas();
  }

  function mousePosition(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (event.button !== undefined && event.button !== 0) return;
    state.dragging = true;
    state.dragMoved = false;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', function (event) {
    var position = mousePosition(event);
    state.pointerX = position.x;
    state.pointerY = position.y;
    if (state.dragging) {
      var dx = event.clientX - state.lastX;
      var dy = event.clientY - state.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) state.dragMoved = true;
      state.yaw += dx * 0.008;
      state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch + dy * 0.008));
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      drawCanvas();
      return;
    }
    var nearest = null;
    var nearestDistance = 18;
    state.plot.forEach(function (point) {
      var distance = Math.hypot(position.x - point.x, position.y - point.y);
      if (distance < nearestDistance) { nearest = point; nearestDistance = distance; }
    });
    var ticker = nearest ? nearest.issuer.ticker : null;
    if (ticker !== state.hovered) {
      state.hovered = ticker;
      if (ticker) renderIssuerPanel(ticker);
      else renderIssuerPanel(state.selected);
    }
    drawCanvas();
  });
  canvas.addEventListener('pointerup', function (event) {
    if (state.dragging && !state.dragMoved) {
      var position = mousePosition(event);
      var nearest = null;
      var nearestDistance = 22;
      state.plot.forEach(function (point) {
        var distance = Math.hypot(position.x - point.x, position.y - point.y);
        if (distance < nearestDistance) { nearest = point; nearestDistance = distance; }
      });
      if (nearest) selectTicker(nearest.issuer.ticker);
    }
    state.dragging = false;
  });
  canvas.addEventListener('pointercancel', function () { state.dragging = false; });
  canvas.addEventListener('pointerleave', function () {
    if (!state.dragging) {
      state.hovered = null;
      renderIssuerPanel(state.selected);
      drawCanvas();
    }
  });
  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    state.zoom = Math.max(0.68, Math.min(1.6, state.zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
    drawCanvas();
  }, { passive: false });
  canvas.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') state.yaw -= 0.12;
    else if (event.key === 'ArrowRight') state.yaw += 0.12;
    else if (event.key === 'ArrowUp') state.pitch = Math.min(1.2, state.pitch + 0.12);
    else if (event.key === 'ArrowDown') state.pitch = Math.max(-1.2, state.pitch - 0.12);
    else if (event.key === 'Enter' && state.hovered) selectTicker(state.hovered);
    else return;
    event.preventDefault();
    drawCanvas();
  });

  function setView(view) {
    var isScatter = view === 'scatter';
    scatterView.classList.toggle('hidden', !isScatter);
    scorecardView.classList.toggle('hidden', isScatter);
    scatterTab.classList.toggle('active', isScatter);
    tableTab.classList.toggle('active', !isScatter);
    scatterTab.setAttribute('aria-selected', isScatter ? 'true' : 'false');
    tableTab.setAttribute('aria-selected', isScatter ? 'false' : 'true');
    if (isScatter) drawCanvas();
  }
  scatterTab.addEventListener('click', function () { setView('scatter'); });
  tableTab.addEventListener('click', function () { setView('table'); });
  search.addEventListener('input', function () {
    state.query = search.value;
    renderTable();
    drawCanvas();
  });
  groupFilter.addEventListener('change', function () {
    state.group = groupFilter.value;
    renderTable();
    drawCanvas();
  });
  ['x', 'y', 'z'].forEach(function (axisName) {
    var control = document.getElementById('axis-' + axisName);
    control.addEventListener('change', function () {
      var chosen = control.value;
      var otherNames = ['x', 'y', 'z'].filter(function (name) { return name !== axisName; });
      otherNames.forEach(function (otherName) {
        if (state.axes[otherName] === chosen) {
          var replacement = Object.keys(FACTORS).find(function (candidate) {
            return candidate !== chosen && otherNames.every(function (name) { return name === otherName || state.axes[name] !== candidate; });
          });
          state.axes[otherName] = replacement;
          document.getElementById('axis-' + otherName).value = replacement;
        }
      });
      state.axes[axisName] = chosen;
      drawCanvas();
    });
  });
  document.getElementById('reset-view').addEventListener('click', function () {
    state.yaw = -0.72;
    state.pitch = 0.43;
    state.zoom = 1;
    drawCanvas();
  });
  window.addEventListener('resize', drawCanvas);

  fetch('data/demo-universe.json').then(function (response) {
    if (!response.ok) throw new Error('Could not load the example issuer file.');
    return response.json();
  }).then(function (data) {
    state.issuers = data.issuers;
    state.scores = buildScores(state.issuers);
    document.getElementById('issuer-count').textContent = String(state.issuers.length).padStart(2, '0');
    state.selected = state.issuers.some(function (issuer) { return issuer.ticker === 'BBCA'; }) ? 'BBCA' : state.issuers[0].ticker;
    renderIssuerPanel(state.selected);
    renderTable();
    drawCanvas();
  }).catch(function () {
    panel.innerHTML = '<div class="empty-selection"><span class="empty-glyph">!</span><h3>Example data could not load</h3><p>Open this page through a local static server, then refresh. The app makes no external data requests.</p></div>';
    ctx.fillStyle = '#91a2b9';
    ctx.textAlign = 'center';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('Serve the project folder locally to load demo data.', canvas.clientWidth / 2, canvas.clientHeight / 2);
  });
}());
