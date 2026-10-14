# Commander Brawl

Play Magic: The Gathering Commander over webcams, with up to four players. Use your phone as the camera without installing anything on it.

There are no servers. Everyone installs the app, one player hosts the table, and video goes directly between the players. Voice stays on Discord.

## Install

**Windows** (in PowerShell):

```powershell
irm https://github.com/Entex/commander-brawl/releases/latest/download/install.ps1 | iex
```

**macOS and Linux** (in a terminal):

```sh
curl -fsSL https://github.com/Entex/commander-brawl/releases/latest/download/install.sh | sh
```

When a new version is out, the app offers it on the start screen and updates itself in a click (or run the command again). The previous version is kept: `sh install.sh --rollback` goes back to it (on Windows, set `$env:CB_ROLLBACK = '1'` and run the installer again). The scripts download and unpack the app themselves, so there are no "unknown publisher" warnings.

## Play

1. **Camera.** Click _Set up camera_ and scan the QR code with your phone, on the same Wi-Fi. The phone warns that the connection isn't private, because the page comes from your own computer: tap _Advanced → Proceed_ (Android) or _Show Details → visit this website_ (iPhone). Any webcam works too. _Straighten the view_ turns an angled view of your playmat into a top-down one, and _Resolution_ sets how sharp the camera films: 4K makes close-ups sharper, while the others always get at most 1080p.
2. **Host.** One player clicks _Host_ and shares the invite link, for example in Discord. The app asks the router to open TCP port 47801 (UPnP or NAT-PMP). If it can't, it says why, and you can forward the port by hand. On a Mac, the app needs Local Network access (System Settings → Privacy & Security → Local Network).
3. **Join.** Everyone else clicks the link, which opens the app with the invite filled in (or pastes it into the app), and clicks _Join_, or _Watch_ to spectate (up to 8).

A dropped connection, a phone that locks, or a host app that crashes doesn't end the game: the app reconnects and holds your seat, and the host clicks _Resume table_.

## What's in it

- **Turns:** random turn order, phases, and a turn timer or chess clock. On your turn, Space passes it and Ctrl+Space goes to the next phase. **Wait!** (W) flashes "I have a response!" on every screen.
- **Pointing:** right-click a video to ping a card, or drag to draw an arrow, in your color.
- **Life and counters:** life totals, commander damage, poison, counters on cards, tokens, the monarch, the initiative, dungeons, the Ring, day and night, storm.
- **Close-ups:** click a card on any video, or Ctrl+drag (⌘+drag) a box around it. You get a sharp picture straight from that player's camera, and which card it is (read on your computer, offline).
- **Cards:** search every card (Ctrl+K), with rulings. They come from Scryfall once, then work offline.
- **Decks and Rule 0:** import a deck from a Moxfield, Archidekt, TappedOut, Deckstats or Scryfall link, or a pasted list. Rule 0 checks each deck against its bracket (Game Changers, combos, land denial, extra turns), and the table warns when someone is one piece away from a combo.
- **Roll:** dice, coin flips and random players, rolled by the host so everyone can trust the result.
- **Planechase and Archenemy.**
- **Recap and History:** who won and the key moments of each game, the game log, and stats per player and deck. Export them to share with friends.
- **Streaming and clips:** a clean view for OBS, and _Last 30 s_ saves the last half minute as a video.

## Development

You need Node.js 24 or newer.

```sh
npm install
npm run dev          # the app, with live reload for the UI
npm run check        # type-check, lint, unit + integration tests, browser video tests
npm run test:e2e     # the full app, two copies (needs a display; on headless Linux: xvfb-run -a npm run test:e2e)
npm run package      # release/: one archive per platform, the install scripts, SHA256SUMS
```

To release a version, set it in `package.json`, then push a tag for it: `git tag v0.2.0 && git push origin v0.2.0`. The Release workflow builds every platform and publishes the release, and installed apps offer it when they start.

The browser tests use Playwright's Chromium (`npx playwright install chromium`), or set `CB_CHROMIUM` to one you have. To add an icon, put its name in `scripts/game-icons.mjs` and run `npm run game-icons`.

The code follows clean architecture: inner layers never depend on outer ones, which `tests/unit/architecture.test.ts` enforces.

```
src/
  domain/          Game rules: seats, events and the state they add up to. No dependencies.
  application/     Use cases: seating, the shared game log, video links, invites, card search and recognition.
  infrastructure/  protocol/ (messages), node/ (host server, TLS, router ports), browser/ (WebRTC, cameras, OCR).
  desktop/         The Electron app: main process, preload bridge, React UI.
  phone/           The camera page that phones open.
tests/             unit/, integration/, browser/ (real WebRTC in Chromium), e2e/ (the packaged app).
site/              The page invite links go to, which opens the app (GitHub Pages, published by the Pages workflow).
```

**How it works.** The phone sends its video only to its own player's computer, which sends it on directly to each other player (WebRTC), encoded separately for each. The host introduces the players and keeps the game log in order; video doesn't pass through it. Every change is an event ("Alex −3 life") that the host puts in order and sends to everyone. Changes are relative, so two at the same moment both count, and each has an id, so resending one after a dropped connection never applies it twice.

| Setting (environment variable)   | Effect                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `CB_USER_DATA_DIR`               | Keep settings and certificates in this folder, so several copies can run side by side. |
| `CB_UPNP=off`                    | Don't ask the router to open a port.                                                   |
| `CB_LOCAL_ONLY=1`                | Don't use the public address-lookup (STUN) server; local network only.                 |
| `CB_TABLE_PORT`, `CB_PHONE_PORT` | Ports for hosting and for the phone page (`0` = any free port).                        |
| `CB_RENDERER_URL`                | Load the UI from a dev server.                                                         |
| `CB_SCRYFALL_API`                | A stand-in for Scryfall's API (tests use a local fake).                                |
| `CB_SPELLBOOK_API`               | A stand-in for Commander Spellbook (tests use a local fake).                           |
| `CB_SAVE_DIR`                    | Save files (like the game log) here without asking.                                    |
| `CB_UPDATES_API`                 | A stand-in for GitHub's API, where new versions are found (tests use a local fake).    |

## Credits and license

- Icons: [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- Font: [Cinzel](https://github.com/NDISCOVER/Cinzel-Typeface) by Natanael Gama, SIL Open Font License 1.1.
- Card data and pictures: [Scryfall](https://scryfall.com). Combos and deck links: [Commander Spellbook](https://commanderspellbook.com). Finding your internet address: [Cloudflare's STUN server](https://developers.cloudflare.com/realtime/turn/).
- The libraries' licenses come with the app, in `THIRD_PARTY_LICENSES.txt`.

Commander Brawl's own code is [MIT](LICENSE) licensed. Commander Brawl is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
