# day-sources-cli

CLI + Pages demo to look up day-related information from ranked sources.

## Sources (string keys)
- `un` → UN International Days
- `de_holidays` → German official/public holiday data (state-specific)
- `who_days` → WHO institution days
- `unesco_days` → UNESCO institution days
- `eu_days` → EU institution days
- `de_namedays` → German name days
- `timeanddate` → Aggregator (timeanddate)
- `curiosity_days` → Curiosity days (non-authoritative)

## Install
```bash
npm install
```

## Run examples
```bash
# only UN + WHO + UNESCO
node src/cli.js --date 2026-02-28 --sources un,who_days,unesco_days

# all sources as JSON
node src/cli.js --date 2026-02-28 --sources all --json

# Germany mode: state public holiday + name days
node src/cli.js --date 2026-02-28 --sources un,de_holidays,de_namedays --germany-mode --state BY
```

## Tests
```bash
npm test
```

## Pages
`npm run build:data` generates `docs/data-latest.json` with **all string-key sources** + Germany mode enabled.
