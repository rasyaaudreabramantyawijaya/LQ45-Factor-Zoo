(function (root) {
  'use strict';

  const MIN_PEERS = 5;
  const MIN_ALIGNED_RETURNS = 126;
  const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '—', '-']);
  const COMPONENTS = [
    'earnings_yield', 'dividend_yield', 'momentum_12_1', 'price_vs_ma200',
    'roe', 'debt_to_equity', 'beta_ihsg', 'idiosyncratic_volatility'
  ];
  const COMPONENT_ALIASES = {
    earnings_yield: ['earnings_yield', 'e_yield'],
    dividend_yield: ['dividend_yield', 'dividend_yield_ttm', 'yield_ttm', 'trailing_dividend_yield'],
    momentum_12_1: ['momentum_12_1', '12_1_return', 'return_12_1'],
    price_vs_ma200: ['price_vs_ma200', 'price_vs_sma200', 'close_vs_sma200', 'ma200_distance'],
    roe: ['roe', 'return_on_equity', 'return_on_equity_ratio'],
    debt_to_equity: ['debt_to_equity', 'debt_to_equity_ratio', 'der'],
    beta_ihsg: ['beta_ihsg', 'ihsg_beta', 'market_beta'],
    idiosyncratic_volatility: ['idiosyncratic_volatility', 'residual_volatility', 'residual_volatility_daily']
  };
  for (const aliases of Object.values(COMPONENT_ALIASES)) {
    aliases.push(...aliases.map(alias => `${alias}_pct`));
  }

  function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/%/g, ' pct ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function normalizeTicker(value) {
    return String(value || '').trim().toUpperCase().replace(/\.JK$/i, '').replace(/[^A-Z0-9._-]/g, '');
  }

  function parseNumber(value, header) {
    let text = String(value ?? '').trim();
    if (MISSING.has(text.toLowerCase())) return null;
    const explicitPercent = text.endsWith('%') || /(?:^|_)pct(?:_|$)/.test(header || '');
    text = text.replace(/%/g, '').replace(/\s/g, '');
    if (text.includes(',') && text.includes('.')) text = text.replace(/,/g, '');
    else if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return explicitPercent ? number / 100 : number;
  }

  function parseCsv(text, name) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < source.length; i += 1) {
      const character = source[i];
      if (quoted) {
        if (character === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ',') { row.push(field); field = ''; }
      else if (character === '\n' || character === '\r') {
        if (character === '\r' && source[i + 1] === '\n') i += 1;
        row.push(field); field = '';
        if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
        row = [];
      } else field += character;
    }
    row.push(field);
    if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
    if (quoted) throw new Error(`${name}: CSV ends inside a quoted field.`);
    if (rows.length < 2) throw new Error(`${name}: expected a header row and at least one data row.`);
    const headers = rows[0].map(normalizeHeader);
    if (!headers.some(Boolean)) throw new Error(`${name}: no usable column names found.`);
    const records = rows.slice(1).map(cells => {
      const record = {};
      headers.forEach((header, index) => { if (header) record[header] = cells[index] ?? ''; });
      return record;
    }).filter(record => Object.values(record).some(value => String(value).trim() !== ''));
    return { name, headers: new Set(headers), records };
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot unpack ZIP/Deflate files. Upload the CSV files directly or use a current Chrome/Edge browser.');
    }
    let stream;
    try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch (_) { throw new Error('This browser cannot unpack ZIP/Deflate files. Upload the CSV files directly or use a current Chrome/Edge browser.'); }
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZipCsvFiles(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024) throw new Error('ZIP is larger than the 25 MB local import limit.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const signature = 0x06054b50;
    let end = -1;
    for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset += 1) {
      if (view.getUint32(offset, true) === signature) end = offset;
    }
    if (end < 0) throw new Error(`${file.name}: ZIP directory was not found.`);
    if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
      throw new Error('Multi-disk ZIP archives are not supported.');
    }
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    if (count > 100) throw new Error('ZIP contains more than 100 entries; split it into smaller archives.');
    const decoder = new TextDecoder();
    const tables = [];
    let expandedBytes = 0;
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error(`${file.name}: invalid ZIP directory entry.`);
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const entryName = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
      if (!entryName.toLowerCase().endsWith('.csv') || entryName.endsWith('/')) continue;
      if (flags & 1) throw new Error(`${entryName}: encrypted ZIP entries are not supported.`);
      if (uncompressedSize > 50 * 1024 * 1024) throw new Error(`${entryName}: CSV expands beyond the 50 MB per-file limit.`);
      expandedBytes += uncompressedSize;
      if (expandedBytes > 100 * 1024 * 1024) throw new Error('ZIP expands beyond the 100 MB total import limit.');
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`${entryName}: invalid ZIP file header.`);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      let uncompressed;
      if (method === 0) uncompressed = compressed;
      else if (method === 8) uncompressed = await inflateRaw(compressed);
      else throw new Error(`${entryName}: ZIP compression method ${method} is not supported; use Store or Deflate.`);
      if (uncompressed.length !== uncompressedSize) throw new Error(`${entryName}: extracted size does not match the ZIP directory.`);
      const basename = entryName.split(/[\\/]/).pop();
      tables.push(parseCsv(new TextDecoder('utf-8', { fatal: false }).decode(uncompressed), basename));
    }
    if (!tables.length) throw new Error(`${file.name}: no CSV files were found in this ZIP.`);
    return tables;
  }

  async function readFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) throw new Error('Choose one or more CSV files or a ZIP archive.');
    if (files.length > 20) throw new Error('Select at most 20 files at a time.');
    if (files.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
      throw new Error('Selected files exceed the 100 MB total local import limit.');
    }
    const tables = [];
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) tables.push(...await readZipCsvFiles(file));
      else if (/\.csv$/i.test(file.name)) {
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name}: CSV is larger than the 50 MB per-file limit.`);
        tables.push(parseCsv(await file.text(), file.name));
      }
      else throw new Error(`${file.name}: only CSV and ZIP files are accepted.`);
    }
    return tables;
  }

  function first(row, aliases) {
    for (const key of aliases) {
      const normalized = normalizeHeader(key);
      if (Object.hasOwn(row, normalized) && !MISSING.has(String(row[normalized]).trim().toLowerCase())) {
        return { value: row[normalized], header: normalized };
      }
    }
    return { value: null, header: '' };
  }

  function numberFrom(row, aliases) {
    const cell = first(row, aliases);
    return cell.value == null ? null : parseNumber(cell.value, cell.header);
  }

  function textFrom(row, aliases, fallback = '') {
    const cell = first(row, aliases);
    return cell.value == null ? fallback : String(cell.value).trim();
  }

  function parseDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const checkedDate = (year, month, day) => {
      const y = Number(year), m = Number(month), d = Number(day);
      const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
    if (iso) return checkedDate(iso[1], iso[2], iso[3]);
    const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (dmy) return checkedDate(dmy[3], dmy[2], dmy[1]);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  function dateFrom(row, aliases) {
    const cell = first(row, aliases);
    return parseDate(cell.value);
  }

  function qtile(values, probability) {
    const ordered = values.slice().sort((a, b) => a - b);
    const position = (ordered.length - 1) * probability;
    const lower = Math.floor(position), upper = Math.ceil(position);
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
  }

  function crossSection(values, reverse) {
    const eligible = Object.entries(values).filter(([, value]) => Number.isFinite(value));
    const scores = Object.fromEntries(Object.keys(values).map(ticker => [ticker, null]));
    if (eligible.length < MIN_PEERS) return { scores, count: eligible.length, available: false };
    const nums = eligible.map(([, value]) => value);
    const low = qtile(nums, 0.05), high = qtile(nums, 0.95);
    const clipped = nums.map(value => Math.min(high, Math.max(low, value)));
    const mean = clipped.reduce((sum, value) => sum + value, 0) / clipped.length;
    const variance = clipped.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clipped.length;
    const std = Math.sqrt(variance);
    if (!(std > 0) || !Number.isFinite(std)) return { scores, count: eligible.length, available: false };
    eligible.forEach(([ticker], index) => {
      const z = (clipped[index] - mean) / std * (reverse ? -1 : 1);
      scores[ticker] = Math.max(-3, Math.min(3, z));
    });
    return { scores, count: eligible.length, available: true, winsor_limits: [low, high], mean, population_std: std };
  }

  function financialGroup(row) {
    const classify = value => {
      const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!text) return 'unclassified';
      // Check the exclusion first: "Non-financial" contains the word "financial".
      if (/non_?financial/.test(text)) return 'non_financial';
      if (/financial|bank|insurance|investment|securit|finance/.test(text)) return 'financial';
      return 'unclassified';
    };
    const supplied = classify(textFrom(row, ['peer_group', 'peer_group_type'], ''));
    if (supplied !== 'unclassified') return supplied;
    const sector = textFrom(row, ['sector', 'industry', 'sector_name'], '');
    return sector ? (classify(sector) === 'unclassified' ? 'non_financial' : classify(sector)) : 'unclassified';
  }

  function chooseLatest(rows, dateAliases) {
    return rows.slice().sort((a, b) => (dateFrom(a, dateAliases) || '').localeCompare(dateFrom(b, dateAliases) || '')).at(-1) || {};
  }

  function rowTicker(row) { return normalizeTicker(textFrom(row, ['ticker', 'symbol', 'stock', 'code', 'kode_saham', 'kode_emiten'], '')); }
  function factorInputTable(table) {
    const directFactorSentinels = ['earnings_yield', 'e_yield', 'momentum_12_1', '12_1_return', 'return_12_1',
      'price_vs_ma200', 'price_vs_sma200', 'close_vs_sma200', 'ma200_distance',
      'beta_ihsg', 'ihsg_beta', 'market_beta', 'idiosyncratic_volatility',
      'residual_volatility', 'residual_volatility_daily'];
    return directFactorSentinels.flatMap(name => [name, `${name}_pct`])
      .some(name => table.headers.has(normalizeHeader(name)));
  }

  function setComponent(record, name, value, sourceValue, reason) {
    record.components[name] = { value: Number.isFinite(value) ? value : null, source_value: sourceValue ?? null,
      status: Number.isFinite(value) ? 'PENDING_SCORE' : 'UNAVAILABLE', reason: Number.isFinite(value) ? null : (reason || null), score: null, z_score: null, peer_count: 0 };
  }

  function computeMomentum(closes) {
    if (closes.length < 253) return { momentum_12_1: null, price_vs_ma200: null,
      reason: `Only ${closes.length} closes; 253 required for 12–1 return and SMA200 distance.` };
    const values = closes.map(row => row.close);
    const sma200 = values.slice(-200).reduce((sum, value) => sum + value, 0) / 200;
    return { momentum_12_1: values.at(-22) / values.at(-253) - 1,
      price_vs_ma200: values.at(-1) / sma200 - 1, reason: null };
  }

  function returnsByDate(prices) {
    const sorted = Array.from(prices.entries()).sort(([a], [b]) => a.localeCompare(b));
    const returns = new Map();
    for (let i = 1; i < sorted.length; i += 1) {
      const [oldDate, oldPrice] = sorted[i - 1], [date, price] = sorted[i];
      if (oldPrice > 0 && price > 0) returns.set(date, { value: price / oldPrice - 1, previous: oldDate });
    }
    return { sorted, returns };
  }

  function alignAndRegress(prices, benchmark) {
    const issuer = returnsByDate(prices), index = returnsByDate(benchmark);
    const indexPosition = new Map(index.sorted.map(([day], position) => [day, position]));
    const aligned = [];
    for (const [day, own] of issuer.returns) {
      const market = index.returns.get(day);
      if (!market || !indexPosition.has(own.previous) || indexPosition.get(day) !== indexPosition.get(own.previous) + 1) continue;
      const gap = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${own.previous}T00:00:00Z`)) / 86400000;
      if (gap > 7) continue;
      aligned.push([own.value, market.value]);
    }
    if (aligned.length < MIN_ALIGNED_RETURNS) return { beta: null, residual: null, count: aligned.length,
      reason: `Only ${aligned.length} aligned daily returns; ${MIN_ALIGNED_RETURNS} required.` };
    const xs = aligned.map(pair => pair[1]), ys = aligned.map(pair => pair[0]);
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const varianceX = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
    if (!(varianceX > 0)) return { beta: null, residual: null, count: aligned.length, reason: 'IHSG return variance is zero.' };
    const covariance = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0);
    const beta = covariance / varianceX;
    const alpha = meanY - beta * meanX;
    const residual = Math.sqrt(ys.reduce((sum, y, i) => sum + (y - alpha - beta * xs[i]) ** 2, 0) / ys.length);
    return { beta, residual, count: aligned.length, reason: null };
  }

  function makeRawRecords(tables) {
    const directRows = new Map(), fundamentalRows = new Map(), priceRows = new Map();
    let benchmarkRows = [];
    const metadata = new Map();
    const fundamentalNames = ['forward_pe', 'pe_forward', 'dividend_yield_ttm', 'yield_ttm', 'dividend_yield', 'roe', 'return_on_equity', 'debt_to_equity', 'debt_to_equity_ratio', 'der'];
    for (const table of tables) {
      const isDirect = factorInputTable(table);
      const hasDatePrice = table.headers.has('date') || table.headers.has('trading_date') || table.headers.has('tanggal') || table.headers.has('timestamp');
      const closeAliases = ['adj_close', 'adjusted_close', 'close_adjusted', 'close', 'close_price', 'harga_penutupan'];
      const hasClose = closeAliases.some(name => table.headers.has(name));
      const hasFundamental = fundamentalNames.concat(['roe_pct', 'dividend_yield_ttm_pct', 'dividend_yield_pct'])
        .some(name => table.headers.has(normalizeHeader(name)));
      const fileTicker = normalizeTicker(table.name.replace(/\.csv$/i, ''));
      for (const row of table.records) {
        let ticker = rowTicker(row);
        if (isDirect) {
          if (!ticker) continue;
          if (!directRows.has(ticker)) directRows.set(ticker, []);
          directRows.get(ticker).push(row);
        }
        if (hasFundamental && ticker) {
          if (!fundamentalRows.has(ticker)) fundamentalRows.set(ticker, []);
          fundamentalRows.get(ticker).push(row);
          metadata.set(ticker, { company: textFrom(row, ['company', 'company_name', 'issuer'], ticker),
            sector: textFrom(row, ['sector', 'industry', 'sector_name'], ''),
            sub_sector: textFrom(row, ['sub_sector', 'subsector', 'industry_group'], ''),
            report_as_of: dateFrom(row, ['report_as_of', 'as_of', 'available_date', 'date']) || '' });
        }
        if (hasDatePrice && hasClose) {
          const date = dateFrom(row, ['date', 'trading_date', 'tanggal', 'timestamp']);
          // Prefer adjusted closes when a Yahoo-style OHLCV export contains both.
          const close = numberFrom(row, closeAliases);
          if (!date || !(close > 0)) continue;
          const benchmarkFile = /(?:^|[/\\])(?:ihsg|index|benchmark)(?:[-_][^/\\]*)?\.csv$/i.test(table.name);
          const namedBenchmark = /^(IHSG|JKSE|COMPOSITE|IDX|IDXCOMPOSITE)$/i.test(ticker) || benchmarkFile;
          if (!ticker && !namedBenchmark && /^[A-Z0-9._-]{2,12}$/i.test(fileTicker)) ticker = fileTicker;
          if (namedBenchmark) { benchmarkRows.push({ date, close }); continue; }
          if (!ticker) continue;
          if (!priceRows.has(ticker)) priceRows.set(ticker, new Map());
          priceRows.get(ticker).set(date, close);
          const old = metadata.get(ticker) || {};
          metadata.set(ticker, { ...old, company: textFrom(row, ['company', 'company_name'], old.company || ticker),
            sector: textFrom(row, ['sector', 'industry'], old.sector || ''),
            sub_sector: textFrom(row, ['sub_sector', 'subsector'], old.sub_sector || '') });
        }
      }
    }
    const benchmark = new Map();
    for (const row of benchmarkRows) benchmark.set(row.date, row.close);
    const tickers = new Set([...directRows.keys(), ...fundamentalRows.keys(), ...priceRows.keys()]);
    const records = new Map();
    for (const ticker of tickers) {
      const details = metadata.get(ticker) || {};
      const direct = chooseLatest(directRows.get(ticker) || [], ['as_of', 'price_as_of', 'report_as_of', 'date']);
      const fundamental = chooseLatest(fundamentalRows.get(ticker) || [], ['report_as_of', 'as_of', 'available_date', 'date']);
      const source = Object.keys(direct).length ? direct : fundamental;
      const row = { ticker, company: textFrom(source, ['company', 'company_name', 'issuer'], details.company || ticker),
        sector: textFrom(source, ['sector', 'industry', 'sector_name'], details.sector || ''),
        sub_sector: textFrom(source, ['sub_sector', 'subsector', 'industry_group'], details.sub_sector || ''),
        peer_group: financialGroup({ ...details, ...source }), report_as_of: dateFrom(fundamental, ['report_as_of', 'as_of', 'available_date', 'date']) || dateFrom(direct, ['report_as_of']) || details.report_as_of || '',
        components: {}, data_quality: { daily: 'USER_UPLOADED', company_report: Object.keys(fundamental).length ? 'USER_UPLOADED' : 'NOT_PROVIDED',
          daily_coverage_start: '', daily_coverage_end: '', daily_observation_count: 0, aligned_ihsg_returns: 0, feature_notes: [] }, scores: {} };
      if (Object.keys(direct).length) {
        row.data_quality.daily_coverage_start = dateFrom(direct, ['price_coverage_start', 'daily_coverage_start']) || '';
        row.data_quality.daily_coverage_end = dateFrom(direct, ['price_coverage_end', 'daily_coverage_end', 'price_as_of']) || '';
        row.data_quality.daily_observation_count = numberFrom(direct, ['daily_observation_count', 'price_observations']) || 0;
        row.data_quality.aligned_ihsg_returns = numberFrom(direct, ['aligned_ihsg_returns', 'aligned_returns']) || 0;
      }
      const prices = priceRows.get(ticker) || new Map();
      const closes = Array.from(prices.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
      if (closes.length) {
        row.data_quality.daily_coverage_start = closes[0].date;
        row.data_quality.daily_coverage_end = closes.at(-1).date;
        row.data_quality.daily_observation_count = closes.length;
      }
      const directValue = name => numberFrom(direct, COMPONENT_ALIASES[name] || [name]);
      let earnings = directValue('earnings_yield');
      const forwardPe = numberFrom(fundamental, ['forward_pe', 'pe_forward', 'forward_pe_ratio']);
      if (earnings == null && Number.isFinite(forwardPe) && forwardPe > 0) earnings = 1 / forwardPe;
      setComponent(row, 'earnings_yield', earnings, forwardPe, forwardPe != null && forwardPe <= 0 ? 'Forward P/E is non-positive; not inverted.' : null);
      let dividend = directValue('dividend_yield');
      if (dividend == null) dividend = numberFrom(fundamental, ['dividend_yield_ttm', 'dividend_yield_ttm_pct', 'yield_ttm', 'dividend_yield', 'dividend_yield_pct', 'trailing_dividend_yield']);
      if (dividend != null && dividend < 0) dividend = null;
      setComponent(row, 'dividend_yield', dividend, dividend);
      const roe = directValue('roe') ?? numberFrom(fundamental, ['roe', 'roe_pct', 'return_on_equity', 'return_on_equity_ratio']);
      const der = directValue('debt_to_equity') ?? numberFrom(fundamental, ['debt_to_equity', 'debt_to_equity_ratio', 'der']);
      setComponent(row, 'roe', roe, roe);
      setComponent(row, 'debt_to_equity', der, der);
      const momentum = computeMomentum(closes);
      setComponent(row, 'momentum_12_1', directValue('momentum_12_1') ?? momentum.momentum_12_1, null, momentum.reason);
      setComponent(row, 'price_vs_ma200', directValue('price_vs_ma200') ?? momentum.price_vs_ma200, null, momentum.reason);
      const regression = benchmark.size ? alignAndRegress(prices, benchmark) : { beta: null, residual: null, count: 0, reason: 'IHSG benchmark daily prices were not supplied.' };
      row.data_quality.aligned_ihsg_returns = regression.count;
      setComponent(row, 'beta_ihsg', directValue('beta_ihsg') ?? regression.beta, null, regression.reason);
      setComponent(row, 'idiosyncratic_volatility', directValue('idiosyncratic_volatility') ?? regression.residual, null, regression.reason);
      if (row.components.momentum_12_1.value == null && momentum.reason) row.data_quality.feature_notes.push(momentum.reason);
      if (benchmark.size && regression.reason) row.data_quality.feature_notes.push(regression.reason);
      records.set(ticker, row);
    }
    return { records: Array.from(records.values()), benchmark, priceRows };
  }

  function scoreRecords(records, options = {}) {
    const values = Object.fromEntries(COMPONENTS.map(name => [name,
      Object.fromEntries(records.map(record => [record.ticker, record.components[name]?.value ?? null]))]));
    const groups = Object.fromEntries(records.map(record => [record.ticker, record.peer_group || 'unclassified']));
    const details = {};
    for (const name of COMPONENTS) {
      const reverse = ['debt_to_equity', 'beta_ihsg', 'idiosyncratic_volatility'].includes(name);
      if (name === 'roe' || name === 'debt_to_equity') {
        const groupScores = Object.fromEntries(records.map(record => [record.ticker, null]));
        const groupCounts = Object.fromEntries(records.map(record => [record.ticker, 0]));
        for (const group of ['financial', 'non_financial']) {
          const members = records.filter(record => groups[record.ticker] === group);
          if (!members.length) continue;
          const result = crossSection(Object.fromEntries(members.map(record => [record.ticker, values[name][record.ticker]])), reverse);
          Object.assign(groupScores, result.scores);
          members.forEach(record => { groupCounts[record.ticker] = result.count; });
        }
        details[name] = { scores: groupScores, counts: groupCounts };
      } else {
        const result = crossSection(values[name], reverse);
        details[name] = { scores: result.scores, counts: Object.fromEntries(records.map(record => [record.ticker, result.count])) };
      }
    }
    for (const record of records) {
      for (const name of COMPONENTS) {
        const component = record.components[name];
        const score = details[name].scores[record.ticker];
        component.peer_count = details[name].counts[record.ticker] || 0;
        component.z_score = Number.isFinite(score) ? score : null;
        component.score = component.z_score;
        if (!Number.isFinite(component.value)) component.status = 'UNAVAILABLE';
        else if (Number.isFinite(score)) { component.status = 'AVAILABLE'; component.reason = null; }
        else if ((name === 'roe' || name === 'debt_to_equity') && record.peer_group === 'unclassified') {
          component.status = 'UNCLASSIFIED_PEER_GROUP';
          component.reason = 'Quality inputs need an explicit financial or non-financial peer group.';
        }
        else component.status = 'INSUFFICIENT_PEERS';
      }
      const mapping = {
        value: ['earnings_yield', 'dividend_yield'],
        momentum: ['momentum_12_1', 'price_vs_ma200'],
        quality: ['roe', 'debt_to_equity'],
        low_volatility: ['beta_ihsg', 'idiosyncratic_volatility']
      };
      for (const [factor, names] of Object.entries(mapping)) {
        const scored = names.map(name => record.components[name]).filter(item => item.status === 'AVAILABLE' && Number.isFinite(item.z_score));
        const score = scored.length ? Math.max(-3, Math.min(3, scored.reduce((sum, item) => sum + item.z_score, 0) / scored.length)) : null;
        record.scores[factor] = { score, status: scored.length === names.length ? 'AVAILABLE' : scored.length ? 'PARTIAL' : 'UNAVAILABLE', available_components: scored.length };
      }
    }
    const label = options.label || 'Uploaded dataset';
    const factorNames = ['value', 'quality', 'momentum', 'low_volatility'];
    const leaderboards = Object.fromEntries(factorNames.map(factor => [factor,
      records.filter(record => record.scores[factor].status === 'AVAILABLE')
        .sort((a, b) => b.scores[factor].score - a.scores[factor].score || a.ticker.localeCompare(b.ticker))
        .slice(0, 5).map(record => ({ ticker: record.ticker, score: record.scores[factor].score, components: record.scores[factor].available_components, as_of: record.report_as_of }))]));
    const plotted = records.filter(record => ['value', 'momentum', 'quality'].every(factor => record.scores[factor].status === 'AVAILABLE')).length;
    const priceDates = records.map(record => record.data_quality.daily_coverage_end).filter(Boolean).sort();
    const benchmarkDates = Array.from((options.benchmark || new Map()).keys()).sort();
    const asOfPrice = options.asOf || benchmarkDates.at(-1) || priceDates.at(-1) || '—';
    const qualityGroups = { financial: records.filter(record => record.peer_group === 'financial').length,
      non_financial: records.filter(record => record.peer_group === 'non_financial').length };
    return {
      schema_version: 'portfolio-factor-zoo.v1', formula_version: 'cross-sectional-zscore.v1',
      provider: options.demo ? 'IDX Evidence Lab local snapshot' : 'User-uploaded local files',
      source_class: 'derived_metric', dataset_label: label,
      universe: { name: options.demo ? 'LQ45' : 'Imported universe', count: records.length, quality: options.demo ? 'PARTIAL' : 'USER_UPLOADED', membership: options.demo ? 'current snapshot only' : 'as supplied by user' },
      as_of: { price: asOfPrice, benchmark: 'IHSG',
        benchmark_date: benchmarkDates.at(-1) || (options.demo ? options.asOf || null : null),
        issuer_price_date: priceDates.at(-1) || null,
        company_report_dates: Array.from(new Set(records.map(record => record.report_as_of).filter(Boolean))).sort() },
      method: { standardization: 'cross-sectional p5/p95 winsorized population z-score; clipped to [-3, 3]', minimum_peers: MIN_PEERS, minimum_aligned_returns: MIN_ALIGNED_RETURNS },
      records, leaderboards,
      coverage: { issuer_count: records.length, plotted_issuer_count: plotted,
        quality_groups: qualityGroups,
        factors: Object.fromEntries(factorNames.map(factor => [factor, Object.fromEntries(['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].map(status => [status, records.filter(record => record.scores[factor].status === status).length]))])) },
      chart: { type: 'scatter3', x: 'value', y: 'momentum', z: 'quality', color: 'low_volatility', axis_domain: [-3, 3] }
    };
  }

  function buildFromTables(tables, options = {}) {
    if (!Array.isArray(tables) || !tables.length) throw new Error('No CSV data was found.');
    const raw = makeRawRecords(tables);
    if (!raw.records.length) throw new Error('No issuer rows found. Include tickers in a factor-input or fundamentals CSV, or use per-issuer price CSV filenames such as BBCA.csv.');
    return scoreRecords(raw.records, { ...options, benchmark: raw.benchmark, label: options.label || tables.map(table => table.name).join(', ') });
  }

  root.FactorData = { parseCsv, readFiles, buildFromTables, scoreRecords };
})(window);
