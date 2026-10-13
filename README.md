# Commander Brawl

Play Magic: The Gathering Commander over webcams, with up to four players. Use your phone as the camera without installing anything on it.

There are no servers. Everyone installs the app on their computer, and one player hosts the table. Video goes directly between the players. Voice stays on Discord.

## Install

**Windows** (in PowerShell):

```powershell
irm https://github.com/Entex/commander-brawl/releases/latest/download/install.ps1 | iex
```

**macOS and Linux** (in a terminal):

```sh
curl -fsSL https://github.com/Entex/commander-brawl/releases/latest/download/install.sh | sh
```

Run the same command again to update. The previous version is kept. To go back to it, run `sh install.sh --rollback`, or on Windows set `$env:CB_ROLLBACK = '1'` and run the installer again.

These scripts avoid the "unknown publisher" warnings. Windows and macOS only show those warnings for files a browser downloaded, and the scripts download and unpack the app themselves. If you got the archive another way, put it next to the install script and run the script. It removes the "downloaded from the internet" mark.

## Play

1. **Camera.** Click _Set up camera_ and scan the QR code with your phone, which must be on the same Wi-Fi as your computer. The phone browser warns that the connection isn't private. That's expected, because the page comes from your own computer. Tap _Advanced → Proceed_ (Android) or _Show Details → visit this website_ (iPhone). Point the phone at your play area. Any webcam works too, including an iPhone through Continuity Camera on a Mac.
2. **Host.** One player clicks _Host_ and shares the invite code, for example in Discord. The app asks the router to open TCP port 47801 (UPnP). If the router refuses, the app says so; turn on UPnP or forward that port manually.
3. **Join.** Everyone else pastes the invite code and clicks _Join_.

The app recovers from these problems by itself:

- **The phone drops off Wi-Fi or its screen locks.** Only your camera pauses. The phone reconnects when it's back.
- **The connection to the host drops.** Video between players keeps running, and your seat is held for 30 seconds.
- **A video link fails.** It restarts, first gently and then from scratch.
- **The host's app crashes or is closed by accident.** The host opens it again and clicks _Resume table_. Friends' apps are still trying to reconnect, so they come back by themselves, to the same seats and the same game. (_Close table_ in the menu ends the table for everyone.)

**Turns.** _Random turn order_ starts the first turn. The active player clicks through the phases (upkeep, draw, main, combat with its steps, second main, end), so everyone can see where they are, and passes the turn when done. For a turn timer or a chess clock, pick _Clock_ in the menu. Running out doesn't stop anyone: it just shows.

**✋ Wait!** (or the W key) is "Wait, I have a response!": it flashes on every screen with your name, and your seat lights up, so it isn't lost when everyone talks at once. It also pauses the clock until the active player moves on.

**Pointing.** Right-click a spot on any video to ping it ("this creature"); drag from one spot to another, on the same video or someone else's, to draw an arrow ("attacking you"). Everyone sees it in the same spot, even with a flipped video, in your color and with your name, for a few seconds.

**Markers.** A player's _Details_ has the monarch, the initiative (which ventures into Undercity), dungeon progress room by room for every paper dungeon, the Ring's temptations and the city's blessing; they show on the seat. Day and night and the storm count (for the current turn) are under _Counters_ and show in the bar at the top.

**🎲 Roll** has dice (d6, d20 and the rest, or any number of dice with any number of sides), a coin flip, and a random opponent or player. The host rolls, so everyone can trust the result: it shows on every screen and lands in the game log, and nobody can send a result of their own.

**Life totals** sit on each seat. Anyone can change anyone's total, and the toolbar shows the last change and who made it. Quick clicks are grouped, so three taps on −1 become one "−3". _New game_ (click twice) resets everything.

Every change goes into a game log kept by the host, and each player's app has a full copy of it.

- If your connection drops, your changes wait and are sent when it's back.
- A player who reconnects, or joins late, catches up on everything they missed.

**Cards** (or Ctrl+K) looks up any card: picture, text, both faces, official rulings, and whether it's a Game Changer or banned in Commander. Search forgives typos ("rhystc stdy"). The app downloads all cards from [Scryfall](https://scryfall.com) once (about 30 MB, in the background on first start) and refreshes them weekly, so searching is instant and works offline. Pictures load from Scryfall.

**Decks** (on the start screen, or in the menu at the table) imports your decks from a Moxfield or Archidekt link, or a pasted list (Moxfield, Archidekt, MTGO and Arena exports all work). They're saved on your computer. At the table, _Play this deck_ shows everyone which deck you're playing, and its commander names are used for commander damage.

**Rule 0** (next to the turn controls) is the talk before the game: everyone says their deck's bracket (1–5), and the app checks each deck with [Commander Spellbook](https://commanderspellbook.com) for Game Changers, two-card combos, mass land denial and extra turns, and points out what doesn't usually fit the bracket. A seat shows its bracket, with ⚠ if something doesn't fit.

**Close-ups.** Click a card on another player's video to get a sharp picture of it. Their computer takes the picture straight from their camera, without the blur of video compression; a phone takes a full-resolution photo (often 12 megapixels instead of 2). If you've flipped their video, the picture is flipped too.

The app also works out which card it is and lists the likeliest few; click one to see it in _Cards_. It finds the card's outline in the picture and straightens it, reads the name on your computer (with [Tesseract](https://github.com/tesseract-ocr/tesseract), offline), and, if the player is playing a deck, compares the artwork with that deck's cards. Artwork works even when the name is too small to read, and tells which way up a tapped or upside-down card is. It goes by the artwork of each card's usual printing, so a different printing relies on the name.

_Show stats_ in the menu shows resolution, frame rate, bitrate, packet loss and delay for each player.

## Development

You need Node.js 24 or newer.

```sh
npm install
npm run dev          # the app, with live reload for the UI
npm run check        # type-check, lint, unit + integration tests, browser video tests
npm run test:e2e     # the full app, two copies (needs a display; on a headless Linux box: xvfb-run -a npm run test:e2e)
npm run package      # release/: one archive per platform, the install scripts, SHA256SUMS
```

The browser tests use Playwright's Chromium (`npx playwright install chromium`). To use a Chromium you already have, set `CB_CHROMIUM=/usr/bin/chromium`.

### Layout

The code follows clean architecture. Inner layers never depend on outer ones, and `tests/unit/architecture.test.ts` enforces it.

```
src/
  domain/          Game rules: seats, players, game events and the state they add up to. No dependencies.
  application/     Use cases and the interfaces they need: TableHost (who sits where),
                   HostGameLog and GameSync (one shared, ordered game log),
                   TableSession (a direct video link to every other player), invite codes,
                   card search, and working out which card is in a camera picture.
  infrastructure/
    protocol/      Messages between host and players, and between phone and computer.
    node/          Host server, connection to the host, phone page server, TLS certificate, UPnP.
    browser/       WebRTC video links, phone camera sender and receiver, webcams, reading text (Tesseract).
  desktop/         The Electron app: main process, preload bridge, React UI.
  phone/           The camera page that phones open.
tests/
  unit/            Domain and application logic, protocol parsing, architecture rules.
  integration/     Host and players over real TLS connections, including dropped connections.
  browser/         Real WebRTC in headless Chromium: four-player mesh, phone → computer → others;
                   reading a card's name with Tesseract.
  e2e/             The packaged app, driven like a player would.
```

### How the video flows

```
phone ──Wi-Fi──▶ your computer ──direct (WebRTC)──▶ each other player
```

- **The phone talks only to its own player's computer**, over the local network. It never connects to other players or decodes their video.
- **Your computer sends the phone's video to each of the other players**, re-encoded separately for each one so every connection gets the quality it can handle.
- **The host only introduces players to each other and keeps the game log in order.** Video does not pass through the host. Close-ups do: they're sent like the connection setup, through the host's connection, so a picture is a few hundred kilobytes once rather than a constant stream.

### How the game stays in sync

- **Every change is an event** ("Alex −3 life"). The game state is what you get by applying the events in order (`src/domain/src/game.ts`).
- **Changes are relative, not absolute,** so two players changing the same total at the same moment both count.
- **The host gives each event its place in the log** and sends it to everyone, including the player who made it; that's their confirmation.
- **Your own changes show at once** and stay queued until the host confirms them. Each change has an id, so resending after a dropped connection never applies it twice.

### Settings for development and tests

| Variable                              | Effect                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `CB_USER_DATA_DIR`                    | Keep settings and certificates in this folder, so several copies can run side by side. |
| `CB_UPNP=off`                         | Don't ask the router to open a port.                                                   |
| `CB_LOCAL_ONLY=1`                     | Don't use the public address-lookup (STUN) servers; local network only.                |
| `CB_TABLE_PORT`, `CB_PHONE_PORT`      | Ports for hosting and for the phone page (`0` = any free port).                        |
| `CB_RENDERER_URL`                     | Load the UI from a dev server.                                                         |
| `CB_SCRYFALL_API`                     | A stand-in for Scryfall's API (tests use a local fake).                                |
| `CB_MOXFIELD_API`, `CB_ARCHIDEKT_API` | Stand-ins for the deck sites (tests use local fakes).                                  |
| `CB_SPELLBOOK_API`                    | A stand-in for Commander Spellbook (tests use a local fake).                           |
| `CB_SAVE_DIR`                         | Save files (like the game log) here without asking.                                    |
