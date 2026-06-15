# 🛸 Skyland

A pixel-art **MMO in the sky** — inspired by [islands.games](https://islands.games/), reimagined among floating islands and spaceships. Built with a Node.js multiplayer server and a Canvas client. Powered by **Phantom** + the **$SKY** Solana token.

---

## Run it

```bash
npm install
cp .env.example .env      # (already created for you)
npm start
```

Then open **http://localhost:3000** in your browser. Open a second tab to see real multiplayer (other players appear and move live).

> Requires Node 18+.

---

## Configuration (`.env`)

Everything you'll want to tune later lives in `.env`:

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | HTTP + WebSocket port | `3000` |
| `SOLANA_RPC_URL` | Solana RPC endpoint (mainnet/devnet) | mainnet |
| `SOLANA_CLUSTER` | cluster label | `mainnet-beta` |
| `SKY_TOKEN_MINT` | **$SKY contract address (CA)** | `8fa3FLWEk4Y7XLAGsQT8tpA8EcfsfQ9ZgEQVYcAvpump` |
| `SKY_TOKEN_DECIMALS` | token decimals | `6` |
| `TREASURY_WALLET` | wallet that receives territory payments | `DwDoTqae91mTDMskLJgvjwiXz8rsTADdTAxH9YeA4Niq` |
| `TERRITORY_PRICE_SKY` | price per sky tile | `10000` |
| `MARKETPLACE_FEE` | treasury cut on sales | `0.02` (2%) |

Change the token CA or treasury at any time — restart the server and the client picks it up via `/api/config`.

---

## How to play

- **Connect Phantom** or **Play as guest** at the title screen.
- The world is a futuristic **Central City** hub ringed by themed zones, each linked by a **bridge**: **Mining**, **Agricultural**, **Hostile**, **Construction**, and a locked **Exploration** zone.
- **Left-click** the ground to move your pilot (click-to-move). **Cross the bridges on foot** to reach each zone. (WASD/arrows also work.) Spaceships are **coming soon** (purchasable with $SKY) — for now everything is on foot.
- **Left-click a resource node** to walk over and farm **Stone / Iron / Meat** (or press **Space** when standing on one). Farming grants XP.
- **Left-click a creature** to walk up and attack it. Creatures aggro inside their zone but **can never reach Central City**. If you die, you respawn at the city **fountain**.
- The **Exploration Zone is locked** — stepping onto its bridge shows *"The Exploration Zone is currently off-limits."*
- **Mouse wheel** zooms in/out. **Double-click + drag** pans the view. The **minimap (top-right)** shows the whole world and the bridges; **click it to look at any region**.
- **Buy Territory** (top-left): drag-select empty sky tiles, then pay in **$SKY** through Phantom (10,000 $SKY per tile → treasury).
- **🏠 HOME** snaps you back to the fountain.
- Toolbar: **Inventory, Marketplace, Stats, Army, Shipyard, Build**. Sound toggle is top-right.

### Systems

- **Marketplace** — list Stone/Iron/Meat for sale at a $SKY price/qty; buyers pay the seller (+ treasury fee) on-chain via Phantom.
- **Build** — paint floor textures (sand/rock/grass/snow/wood/cloud), place fences, decorations (flowers/lamps/trees), and build **Stone/Iron mines** (cost resources) that passively produce.
- **Stats** — edit your pseudonym and fully customize your character (skin, top, bottom, shoes, hat type + color, glasses) with a live preview.
- **Army** — recruit **Pilot** (ship speed), **Fighter** (more damage), **Healer** (HP regen), **Mage** (combat support) using resources.
- **Shipyard** — *coming soon.* Ships (Scout → Cruiser → Frigate → Dread) will be purchasable with $SKY; they're shown locked/greyed for now.
- **Chat** — press Enter, type, Enter to send to everyone online.

---

## Project layout

```
Skyland/
├── .env / .env.example      # config (token CA, treasury, prices)
├── server/
│   ├── server.js            # HTTP + WebSocket MMO server & game loop
│   ├── world.js             # islands, tiles, creatures, persistence
│   ├── solana.js            # on-chain $SKY payment verification
│   └── config.js            # env loader
├── public/
│   ├── index.html           # HUD shell
│   ├── styles.css           # pixel UI
│   └── js/
│       ├── main.js          # engine: render, input, movement, combat
│       ├── ui.js            # modal panels
│       ├── wallet.js        # Phantom + SPL $SKY transfers
│       ├── sprites.js       # procedural pixel-art (no image assets)
│       ├── net.js           # WebSocket + REST client
│       └── state.js         # shared client state
└── data/world.json          # auto-saved tile ownership & listings
```

---

## How the on-chain payments work

1. The client builds an SPL token transfer of `$SKY` via `@solana/web3.js` and asks **Phantom** to sign + send it.
2. The transaction signature is sent to the server.
3. `server/solana.js` fetches the confirmed transaction and verifies the **treasury's $SKY balance actually increased by the expected amount** before granting territory or settling a sale. Signatures are single-use (no replay).

Because payments are **real mainnet transactions**, test with a wallet that holds a little $SKY (and some SOL for fees). To experiment safely, point `SOLANA_RPC_URL`/`SOLANA_CLUSTER` at **devnet** and use a devnet token.

---

## What's solid vs. what's next

**Working now:** real-time multiplayer movement + chat, world/island rendering, tile grid, farming, creature AI with leashed aggro zones, death/respawn at the fountain, XP/leveling, inventory, marketplace, character customization, army, shipyard, build/decoration, Phantom connect, and real $SKY transfers with server-side verification.

**Natural next steps:** server-authoritative inventory & XP (currently client-side for responsiveness), persistent player accounts keyed to wallet, anti-cheat validation on farming/combat, mobile virtual joystick, richer sprite art, and a global territory map view.
