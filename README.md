# day-sources-cli

CLI + Pages demo to look up day-related information from ranked sources.

## Sources
1. UN International Days
2. German official/public holiday data (state-specific)
3. WHO / UNESCO / EU institution days
4. German name days
5. Aggregator (timeanddate)
6. Curiosity days (non-authoritative)

## Install
```bash
npm install
```

## Run examples
```bash
# only sources 1 and 3
node src/cli.js --date 2026-02-28 --sources 1,3

# all sources as JSON
node src/cli.js --date 2026-02-28 --sources all --json

# Germany mode: state public holiday + name days
node src/cli.js --date 2026-02-28 --sources 1,3 --germany-mode --state BY
```

## Tests
```bash
npm test
```

## Pages
`npm run build:data` now generates `docs/data-latest.json` with **all sources** + Germany mode enabled.
