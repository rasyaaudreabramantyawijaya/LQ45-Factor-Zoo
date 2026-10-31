# IDX Factor Zoo

An independent, standalone educational demo of a four-factor research view for selected IDX issuers. It separates the Factor Zoo concept from the larger IDX Evidence Lab application and offers a small interactive example that runs locally in a browser.

> **Synthetic data notice:** the ticker names are examples, but every numeric input and score shown in the interactive demo is generated synthetic data. Nothing here is a current issuer metric, forecast, validated alpha, portfolio recommendation, or investment advice.

<a href="https://rasyaaudreabramantyawijaya.github.io/IDX-Factor-Zoo/"><img src="assets/factor-zoo-preview.png" alt="Preview of the IDX Factor Zoo interactive dashboard. Click to open the live interactive demonstration." width="100%"></a>

[Open the interactive demo](https://rasyaaudreabramantyawijaya.github.io/IDX-Factor-Zoo/) · [View the source repository](https://github.com/rasyaaudreabramantyawijaya/IDX-Factor-Zoo)

## What the demo shows

The interactive scatter plot places issuers in a three-dimensional factor space. Drag the plot to rotate it, scroll to zoom, and hover or click points to inspect a ticker's raw example inputs and standardized scores. Use the controls to change factor axes, search issuers, and filter by peer group. The Scorecard tab displays the same calculated scores in a selectable table.

The example universe includes BBCA, BBRI, BMRI, BBNI, BBTN, TLKM, ASII, ADRO, ANTM, and ICBP. Numeric values for all ten are fictional. The sample intentionally uses five financial and five non-financial examples so peer-group standardization can be illustrated.

## Factor definitions

| Factor | Components in this demo | Direction |
| --- | --- | --- |
| Value | Earnings yield (1 / verified positive forward P/E in the source model) and trailing dividend yield | Higher yield scores higher |
| Quality | Return on equity and inverse debt-to-equity | Higher ROE and lower leverage score higher |
| Momentum | 12-to-1-month price return and price distance from SMA200 | Stronger trailing trend scores higher |
| Low Volatility | Inverse market beta and inverse residual volatility from an OLS market model versus IHSG | Lower estimated sensitivity and residual volatility score higher |

### Scoring outline

1. For each component, take the eligible issuer cross-section and winsorize observations at its 5th and 95th percentiles.
2. Reverse the component sign where lower raw values are preferable (debt-to-equity, beta, and residual volatility).
3. Convert the clipped component to a population z-score, using the cross-sectional mean and population standard deviation, then clip the score to the range −3 to +3.
4. Standardize financial and non-financial quality inputs within their respective peer groups. Other components use the eligible selected cross-section.
5. Compute each factor as the arithmetic mean of its available component z-scores. Missing component values remain missing rather than becoming zero. A component needs at least five eligible peers.

This is a concise educational reconstruction of the source project's factor methodology, with a fresh standalone implementation and synthetic demo inputs. The real source implementation requires at least 126 aligned daily returns to estimate beta and residual volatility; this static demo does not calculate those values from return series. It is not the original app module transplanted verbatim. The original source project may evolve independently.

## Model and interpretation

This is a **cross-sectional factor-characteristics model**, not a forecasting or optimization model. It describes the relative position of example issuers on selected characteristics. It does not estimate future returns, demonstrate factor premia, produce a buy/sell signal, infer beneficial ownership, or allocate capital. The label “Factor Zoo” refers to the grouped factor dimensions in the research view; this demo implements four composite characteristics rather than a comprehensive academic zoo of hundreds of factors.

A defensible empirical study would require point-in-time financial statement availability, corporate-action-adjusted price histories, a historical IDX membership universe including delisted issuers, treatment of suspensions and stale reports, consistent sector/industry peer groups, explicit rebalancing and trading costs, and time-ordered out-of-sample tests. No such market-data analysis or performance test is included here.

## Run locally

No build step, package manager, API key, server, database, or internet connection is needed after cloning. Open `index.html` in a modern browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

## Provenance and attribution

The four-factor design and associated source methodology are based on the Factor Zoo work in [IDX Evidence Lab](https://github.com/rasyaaudreabramantyawijaya/IDX-Evidence-Lab), particularly:

- [`portfolio_factors.py`](https://github.com/rasyaaudreabramantyawijaya/IDX-Evidence-Lab/blob/main/src/idx_evidence_lab/portfolio/portfolio_factors.py) — factor scoring methodology.
- [`130-portfolio-lab-factor-zoo.js`](https://github.com/rasyaaudreabramantyawijaya/IDX-Evidence-Lab/blob/main/frontend/legacy/scripts/130-portfolio-lab-factor-zoo.js) — source-project visualization behavior.
- [`portfolio-factor-zoo-data.json`](https://github.com/rasyaaudreabramantyawijaya/IDX-Evidence-Lab/blob/main/docs/prototypes/portfolio-factor-zoo-data.json) — source-project demo-data artifact and its coverage status.

The source snapshot inspected for this independent demo was commit `0d8b3c99cc2a4bf54857e790a22152561a8121b6`. The linked source project's local snapshot reported momentum coverage but marked Value, Quality, and Low Volatility unavailable; therefore those source values were not reused here. This standalone demo uses visibly labeled synthetic examples instead. The upstream repository contained no root license file in the inspected snapshot; this repository therefore links and attributes the methodology but does not copy the upstream implementation code.

## Project files

- `index.html` — standalone interface.
- `src/factor-zoo.js` — scoring, chart interactions, and issuer detail rendering.
- `src/styles.css` — responsive visual design.
- `data/demo-universe.json` — clearly labeled synthetic example inputs.
- `assets/factor-zoo-preview.png` — browser capture of the demo linked to its interactive hosted version.

## Limitations

- Static demo universe with ten selected IDX ticker examples; it is not a full IDX universe.
- Synthetic observations only; no historical price or financial-report data are bundled.
- No live data provider, API, authentication, persistence, database, forecast, or portfolio optimizer.
- A z-score expresses relative rank in the selected peer cross-section and depends on peer membership and data quality.
- This project is educational research software and not financial advice.
