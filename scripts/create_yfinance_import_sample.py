#!/usr/bin/env python3
"""Fetch a small Yahoo Finance IDX sample ZIP for the local Factor Zoo importer.

Requires the optional ``yfinance`` and ``pandas`` packages. The generated archive
contains adjusted daily closes, an adjusted IHSG proxy, and a point-in-time
retrieval snapshot of issuer fundamentals/valuation inputs. No credentials are
used. Yahoo Finance availability and field coverage can change over time.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import warnings
import zipfile
from pathlib import Path

import pandas as pd
import yfinance as yf


ISSUERS = {
    "BBCA.JK": ("Financial Services", "Banks - Regional"),
    "BBRI.JK": ("Financial Services", "Banks - Regional"),
    "BMRI.JK": ("Financial Services", "Banks - Regional"),
    "BBNI.JK": ("Financial Services", "Banks - Regional"),
    "BNGA.JK": ("Financial Services", "Banks - Regional"),
    "TLKM.JK": ("Communication Services", "Telecom Services"),
    "ASII.JK": ("Industrials", "Conglomerates"),
    "UNVR.JK": ("Consumer Defensive", "Household & Personal Products"),
    "ICBP.JK": ("Consumer Defensive", "Packaged Foods"),
    "INDF.JK": ("Consumer Defensive", "Packaged Foods"),
}
BENCHMARK = "^JKSE"


def safe_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def date_text(value: object) -> str:
    stamp = pd.Timestamp(value)
    if stamp.tzinfo is not None:
        stamp = stamp.tz_convert(None)
    return stamp.date().isoformat()


def field_series(frame: pd.DataFrame, symbol: str, field: str) -> pd.Series:
    if isinstance(frame.columns, pd.MultiIndex):
        if (symbol, field) in frame.columns:
            series = frame[(symbol, field)]
        elif (field, symbol) in frame.columns:
            series = frame[(field, symbol)]
        else:
            raise RuntimeError(f"Yahoo returned no {field} column for {symbol}.")
    elif field in frame.columns:
        series = frame[field]
    else:
        raise RuntimeError(f"Yahoo returned no {field} column for {symbol}.")
    series = pd.to_numeric(series, errors="coerce").dropna()
    return series.sort_index()


def history_snapshot(
    symbol: str,
    market_as_of: dt.date,
    raw_closes: pd.Series,
    dividend_events: pd.Series,
) -> dict[str, object]:
    ticker = yf.Ticker(symbol)
    info = ticker.get_info()
    raw_closes = raw_closes.dropna().sort_index()
    if raw_closes.empty:
        raise RuntimeError(f"Yahoo returned no raw Close values for {symbol}.")
    price_date_stamp = pd.Timestamp(raw_closes.index[-1])
    if price_date_stamp.tzinfo is not None:
        price_date_stamp = price_date_stamp.tz_convert(None)
    price_date = price_date_stamp.date()
    raw_close = safe_number(raw_closes.iloc[-1])
    if raw_close is None or raw_close <= 0 or price_date > market_as_of:
        raise RuntimeError(f"Yahoo returned an invalid latest raw close for {symbol}.")

    ttm_start = price_date - dt.timedelta(days=365)
    trailing_dividends = sum(
        float(amount)
        for event_date, amount in ((pd.Timestamp(day).date(), value) for day, value in dividend_events.items())
        if ttm_start < event_date <= price_date and float(amount) > 0
    )
    dividend_yield = trailing_dividends / raw_close

    most_recent_quarter = info.get("mostRecentQuarter")
    report_as_of = ""
    if most_recent_quarter:
        try:
            report_as_of = date_text(pd.to_datetime(most_recent_quarter, unit="s", utc=True))
        except (TypeError, ValueError, OverflowError):
            report_as_of = ""
    if report_as_of and report_as_of > dt.date.today().isoformat():
        report_as_of = ""

    debt_to_equity_percent = safe_number(info.get("debtToEquity"))
    # Yahoo's quoteSummary debtToEquity field is expressed in percent; the
    # Factor Zoo importer expects a plain ratio (for example, 59.982% -> 0.59982).
    debt_to_equity = debt_to_equity_percent / 100 if debt_to_equity_percent is not None else None
    return {
        "ticker": symbol.removesuffix(".JK"),
        "company": str(info.get("shortName") or info.get("longName") or symbol),
        "sector": str(info.get("sector") or ISSUERS[symbol][0]),
        "sub_sector": str(info.get("industry") or ISSUERS[symbol][1]),
        "report_as_of": report_as_of,
        "valuation_snapshot_as_of": dt.date.today().isoformat(),
        "forward_pe": safe_number(info.get("forwardPE")),
        "dividend_yield_ttm": dividend_yield,
        "trailing_cash_dividends_per_share": trailing_dividends,
        "raw_close_for_dividend_yield": raw_close,
        "roe": safe_number(info.get("returnOnEquity")),
        "debt_to_equity": debt_to_equity,
        "debt_to_equity_source_percent": debt_to_equity_percent,
        "price_as_of": price_date.isoformat(),
        "most_recent_quarter_epoch": most_recent_quarter,
        "aligned_market_reference_as_of": market_as_of.isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/examples/yfinance-idx-10y-import.zip"),
        help="Output ZIP path (default: data/examples/yfinance-idx-10y-import.zip)",
    )
    args = parser.parse_args()
    warnings.filterwarnings("ignore", category=FutureWarning, module="yfinance")

    symbols = [*ISSUERS, BENCHMARK]
    prices = yf.download(
        symbols,
        period="10y",
        interval="1d",
        auto_adjust=False,
        actions=True,
        progress=False,
        threads=True,
        group_by="ticker",
        timeout=30,
    )
    if prices.empty:
        raise RuntimeError("Yahoo Finance returned an empty 10-year price response.")

    price_rows: list[dict[str, object]] = []
    series_by_symbol: dict[str, pd.Series] = {}
    raw_close_by_symbol: dict[str, pd.Series] = {}
    dividends_by_symbol: dict[str, pd.Series] = {}
    for symbol in symbols:
        try:
            series = field_series(prices, symbol, "Adj Close")
        except RuntimeError:
            series = field_series(prices, symbol, "Close")
        series = series[series > 0]
        if len(series) < 253:
            raise RuntimeError(f"{symbol} has only {len(series)} adjusted closes; at least 253 are required.")
        series_by_symbol[symbol] = series
        raw_close_by_symbol[symbol] = field_series(prices, symbol, "Close")
        try:
            dividends_by_symbol[symbol] = field_series(prices, symbol, "Dividends")
        except RuntimeError:
            dividends_by_symbol[symbol] = pd.Series(dtype=float)
        for day, close in series.items():
            price_rows.append({"ticker": "JKSE" if symbol == BENCHMARK else symbol.removesuffix(".JK"),
                               "date": date_text(day), "close": float(close)})

    market_as_of = pd.Timestamp(series_by_symbol[BENCHMARK].index[-1])
    if market_as_of.tzinfo is not None:
        market_as_of = market_as_of.tz_convert(None)
    market_as_of_date = market_as_of.date()
    fundamental_rows = [history_snapshot(symbol, market_as_of_date,
                                          raw_close_by_symbol[symbol], dividends_by_symbol[symbol])
                        for symbol in ISSUERS]

    latest_dates = {row["ticker"]: row["price_as_of"] for row in fundamental_rows}
    price_dates = {symbol.removesuffix(".JK"): date_text(series.index[-1])
                   for symbol, series in series_by_symbol.items() if symbol != BENCHMARK}
    if any(date != price_dates[ticker] for ticker, date in latest_dates.items()):
        raise RuntimeError(f"Price and fundamental snapshots do not align: prices={price_dates}, metadata={latest_dates}")

    prices_csv = pd.DataFrame(price_rows).to_csv(index=False, lineterminator="\n")
    fundamentals_csv = pd.DataFrame(fundamental_rows).to_csv(index=False, lineterminator="\n")
    issuer_counts = {ticker.removesuffix(".JK"): int(len(series_by_symbol[ticker])) for ticker in ISSUERS}
    manifest = {
        "dataset": "Yahoo Finance IDX Factor Zoo import smoke sample",
        "retrieved_date": dt.date.today().isoformat(),
        "provider": "Yahoo Finance via the yfinance Python package",
        "yfinance_version": yf.__version__,
        "price_basis": "Yahoo auto-adjusted daily Close (split and distribution adjusted by Yahoo)",
        "price_range": {"start": min(date_text(s.index[0]) for s in series_by_symbol.values()),
                        "end": market_as_of_date.isoformat()},
        "market_reference": {"symbol": BENCHMARK, "import_ticker": "JKSE", "as_of": market_as_of_date.isoformat(),
                             "daily_observations": int(len(series_by_symbol[BENCHMARK]))},
        "issuers": [{"ticker": ticker.removesuffix(".JK"), "yahoo_symbol": ticker,
                     "price_observations": issuer_counts[ticker.removesuffix(".JK")],
                     "sector": next(row["sector"] for row in fundamental_rows if row["ticker"] == ticker.removesuffix(".JK"))}
                    for ticker in ISSUERS],
        "fundamental_field_basis": {
            "forward_pe": "Yahoo quoteSummary forwardPE snapshot, retrieved on retrieved_date",
            "dividend_yield_ttm": "sum of Yahoo per-share cash dividend events during the 365 days through each issuer price_as_of, divided by that date's raw unadjusted Close",
            "roe": "Yahoo quoteSummary returnOnEquity; report_as_of is Yahoo mostRecentQuarter where supplied",
            "debt_to_equity": "Yahoo quoteSummary debtToEquity percent divided by 100 to convert to the ratio expected by the importer; unavailable values remain blank",
            "valuation_snapshot_as_of": "Yahoo quote retrieval date; not a historical point-in-time valuation backtest",
        },
        "limitations": [
            "This is a 10-issuer retrieval/import smoke sample, not the complete IDX universe or historical LQ45 membership.",
            "Yahoo/yfinance data and field availability can be revised, delayed, or incomplete.",
            "Bank debt-to-equity is intentionally left unavailable where Yahoo returns no comparable value.",
            "Quote valuation inputs are current snapshot fields; this archive is not point-in-time historical fundamentals.",
            "No investment advice, forecast, or strategy performance claim is made.",
        ],
        "validation": {"all_issuers_have_10y_history": all(n >= 2000 for n in issuer_counts.values()),
                       "issuer_price_counts": issuer_counts,
                       "all_fundamentals_rows_have_price_as_of": all(row["price_as_of"] == market_as_of_date.isoformat() for row in fundamental_rows)},
    }
    readme = (
        "Yahoo Finance IDX import sample\n"
        f"Retrieved: {manifest['retrieved_date']}\n"
        f"Daily price coverage: {manifest['price_range']['start']} to {manifest['price_range']['end']}\n"
        "Symbols: BBCA, BBRI, BMRI, BBNI, BNGA, TLKM, ASII, UNVR, ICBP, INDF; benchmark JKSE (^JKSE).\n"
        "Drop this ZIP directly onto the Factor Zoo chart. It contains prices.csv, ihsg.csv data in prices.csv via ticker=JKSE, and fundamentals.csv.\n"
        "Adjusted closes are used for momentum, SMA200, beta, and residual-volatility calculations. TTM dividend yields are derived from Yahoo per-share cash dividend events and raw closes.\n"
        "See manifest.json for field basis and limitations. Quote-level valuation fields are not historical point-in-time observations. Missing fields are blank, never imputed.\n"
    )
    # Separate the benchmark file to match the importer convention and make
    # provider inputs straightforward to inspect before importing.
    prices_df = pd.DataFrame(price_rows)
    benchmark_df = prices_df[prices_df["ticker"] == "JKSE"].rename(columns={"ticker": "ticker"})
    issuer_df = prices_df[prices_df["ticker"] != "JKSE"]
    prices_csv = issuer_df.to_csv(index=False, lineterminator="\n")
    ihsg_csv = benchmark_df.to_csv(index=False, lineterminator="\n")
    manifest_text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Store compression maximizes compatibility with browsers lacking raw-deflate.
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("prices.csv", prices_csv)
        archive.writestr("ihsg.csv", ihsg_csv)
        archive.writestr("fundamentals.csv", fundamentals_csv)
        archive.writestr("README.txt", readme)
        archive.writestr("manifest.json", manifest_text)
    print(json.dumps({"output": str(args.output.resolve()), "bytes": args.output.stat().st_size,
                      "retrieved_date": manifest["retrieved_date"], "price_range": manifest["price_range"],
                      "issuer_price_counts": issuer_counts,
                      "complete_fundamental_inputs": {"forward_pe": sum(row["forward_pe"] is not None for row in fundamental_rows),
                                                       "dividend_yield_ttm": sum(row["dividend_yield_ttm"] is not None for row in fundamental_rows),
                                                       "roe": sum(row["roe"] is not None for row in fundamental_rows),
                                                       "debt_to_equity": sum(row["debt_to_equity"] is not None for row in fundamental_rows)}},
                     indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
