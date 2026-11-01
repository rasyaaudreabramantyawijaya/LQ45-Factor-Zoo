'use strict';

// Run from the repository root: node --test tests/factor-data.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');

// The same module runs in a browser and attaches its public API to window.
global.window = global;
require('../src/factor-data.js');

const csv = (name, content) => global.FactorData.parseCsv(content, name);

test('a CSV with only ticker and earnings yield is scored across peers', () => {
  const table = csv('earnings.csv', [
    'ticker,earnings_yield', 'AAA,0.01', 'BBB,0.02', 'CCC,0.03',
    'DDD,0.04', 'EEE,0.05'
  ].join('\n'));
  const data = global.FactorData.buildFromTables([table]);
  assert.equal(data.records.length, 5);
  const first = data.records.find(record => record.ticker === 'AAA');
  assert.equal(first.components.earnings_yield.value, 0.01);
  assert.equal(first.components.earnings_yield.status, 'AVAILABLE');
  assert.equal(first.components.earnings_yield.peer_count, 5);
  assert.ok(Number.isFinite(first.components.earnings_yield.z_score));
});

test('invalid calendar dates are excluded while valid leap days and timestamps remain', () => {
  const table = csv('prices.csv', [
    'ticker,date,close', 'AAA,2026-99-99,100', 'AAA,2026-02-30,110',
    'AAA,31/04/2026,120', 'AAA,2024-02-29,90',
    'AAA,2026-02-28T00:00:00Z,100', 'AAA,30/04/2026,130'
  ].join('\n'));
  const record = global.FactorData.buildFromTables([table]).records[0];
  assert.equal(record.data_quality.daily_observation_count, 3);
  assert.equal(record.data_quality.daily_coverage_start, '2024-02-29');
  assert.equal(record.data_quality.daily_coverage_end, '2026-04-30');
});

test('benchmark and issuer dates stay separate when the benchmark is absent or older', () => {
  const issuer = csv('prices.csv', 'ticker,date,close\nAAA,2026-10-29,100\nAAA,2026-10-30,105');
  const noBenchmark = global.FactorData.buildFromTables([issuer]);
  assert.equal(noBenchmark.as_of.benchmark_date, null);
  assert.equal(noBenchmark.as_of.issuer_price_date, '2026-10-30');
  const ihsg = csv('ihsg.csv', 'date,close\n2026-10-28,100\n2026-10-29,101');
  const differentDates = global.FactorData.buildFromTables([issuer, ihsg]);
  assert.equal(differentDates.as_of.benchmark_date, '2026-10-29');
  assert.equal(differentDates.as_of.issuer_price_date, '2026-10-30');
});

test('directly supplied components do not inherit missing-price error reasons', () => {
  const table = csv('factors.csv', 'ticker,earnings_yield,momentum_12_1\nAAA,0.1,0.2');
  const record = global.FactorData.buildFromTables([table]).records[0];
  assert.equal(record.components.momentum_12_1.value, 0.2);
  assert.equal(record.components.momentum_12_1.reason, null);
  assert.equal(record.components.momentum_12_1.status, 'INSUFFICIENT_PEERS');
});
