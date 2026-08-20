# Golden Compass Bot

Build a professional AI-powered Forex trading bot connected with MetaTrader 5 (MT5). The bot must focus on Forex markets, especially Gold (XAUUSD), and major currency pairs.

Core Requirements:

Create a complete automated trading system with:

MT5 API / Bridge integration

Demo and Real account mode

Live account balance, equity, margin, positions and history

Real-time market data

Automatic order execution

Trading Symbols:

The bot should trade:

Primary:

XAUUSD (Gold)

Secondary:

EURUSD

GBPUSD

USDJPY

AUDUSD

USDCAD

USDCHF

Do not trade crypto.

Advanced Trading Strategy Engine

Create a multi-filter strategy system.

Trade should only open when multiple confirmations agree:

1. Trend Detection

Use:

EMA 50

EMA 200

Trend direction

Market structure

Rules:

BUY: EMA 50 above EMA 200 + bullish structure

SELL: EMA 50 below EMA 200 + bearish structure

2. Momentum Confirmation

Use:

RSI

MACD

ADX

Avoid trades when market is weak.

Minimum conditions:

ADX > 20

RSI: Buy zone: 40-65

Sell zone: 35-60

3. Support & Resistance

Detect:

Major support

Major resistance

Breakouts

Retests

Do not enter trades directly into strong resistance/support.

Risk Management System

Every trade must have:

Automatic Stop Loss

Automatic Take Profit

Risk based lot sizing:

Risk per trade: 0.5% - 1%

Never use dangerous martingale.

Never increase lot after loss.

Smart Stop Loss System

After trade opens:

Initial SL: Based on ATR volatility.

When trade goes into profit:

At +50% TP:

Move SL to breakeven.

At +70% TP:

Move SL into profit.

Protect winning trades.

Trailing Stop System

Implement dynamic trailing stop:

For Gold:

ATR based trailing

Example:

If BUY: Price moves up → SL follows upward

If price reverses: Close with profit

Never allow profitable trade to become loss.

Profit Booking System

Add partial profit taking:

At first target: Close 50% position

Keep remaining position running with trailing stop.

Final target: Close remaining position.

Trading Filters

Do not trade:

During high spread

During abnormal volatility

During news events

When market is sideways

When risk limit reached

AI Analysis Module

Before every trade:

AI should analyze:

Trend

Momentum

Volatility

Market structure

Risk/reward

Only trade if confidence > 75%

Show:

Trade reason Entry price SL TP Risk % Confidence score

Dashboard

Create professional dashboard:

Show:

Current trades

Profit/Loss

Win rate

Drawdown

Total trades

Strategy performance

Best performing symbol

Backtesting Module

Add:

Historical testing

Strategy optimization

Win rate report

Profit factor

Maximum drawdown

Allow changing:

EMA values

RSI settings

Risk %

Trailing distance

Safety Rules

The bot must prioritize capital protection.

Maximum daily loss: 3%

If reached:

Stop trading for the day.

Goal

Create a professional Forex trading bot similar to institutional style systems.

Focus on:

Gold XAUUSD

High probability setups

Risk control

Profit protection

Trailing profit

Consistent trading

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://tradetoprofit.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b38faf6b-b5b7-491e-b861-585e1be8f36c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
