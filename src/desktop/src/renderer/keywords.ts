/**
 * What Magic's keywords mean, in a sentence or two of plain words: keyword abilities (comprehensive rules 702),
 * keyword actions (701) and ability words. Shipped with the app, so it works offline. Keys are lowercase; Scryfall
 * lists each card's keywords.
 */
const KEYWORDS: Readonly<Record<string, string>> = {
  // Evergreen and common abilities
  deathtouch: 'Any amount of damage it deals to a creature is enough to destroy that creature.',
  defender: "It can't attack.",
  'double strike': 'It deals combat damage twice: in a first-strike damage step, then again in the regular one.',
  enchant: 'An Aura with enchant can only be cast on, and stay attached to, the kind of thing it names.',
  equip:
    'Pay the cost to attach this Equipment to a creature you control. Only as a sorcery: in your main phase, with nothing on the stack.',
  'first strike': 'It deals combat damage before creatures without first strike (or double strike).',
  flash: 'You can cast it any time you could cast an instant.',
  flying: "It can't be blocked except by creatures with flying or reach.",
  haste: 'It can attack and use its {T} abilities as soon as it comes under your control.',
  hexproof: "It can't be the target of spells or abilities your opponents control.",
  indestructible: "Damage and effects that say “destroy” don't destroy it. It can still be sacrificed or exiled.",
  intimidate: "It can't be blocked except by artifact creatures and creatures that share a color with it.",
  landwalk: "It can't be blocked as long as the defending player controls a land of the kind named.",
  lifelink: 'Damage it deals also makes its controller gain that much life.',
  protection:
    "Protection from something (a color, say): it can't be blocked, targeted, dealt damage, enchanted or equipped by anything with that quality.",
  reach: 'It can block creatures with flying.',
  shroud: "It can't be the target of any spells or abilities, not even its controller's.",
  trample:
    "When it's blocked, damage beyond what's lethal to the blockers goes to the player, planeswalker or battle it's attacking.",
  vigilance: "Attacking doesn't make it tap.",
  ward: "Whenever it becomes the target of a spell or ability an opponent controls, that's countered unless they pay the ward cost.",
  menace: "It can't be blocked except by two or more creatures.",
  prowess: 'Whenever you cast a spell that isn’t a creature, it gets +1/+1 until end of turn.',
  'split second':
    "While it's on the stack, players can't cast spells or activate abilities that aren't mana abilities.",
  changeling: 'It is every creature type, everywhere: in your hand and library too.',
  devoid: "It's colorless, even though it has colored mana in its cost.",
  partner:
    'You can have two commanders if both have partner. Some say “partner with” a named card: then only with that one.',
  'partner with':
    'You can have both as commanders. When one enters, its player may search their library for the other and put it in their hand.',
  companion:
    'If your deck meets its condition, it can start the game outside it. Pay {3} as a sorcery to put it into your hand, once.',

  // Costs and ways to cast
  kicker: 'You may pay an extra cost as you cast it, for an extra effect.',
  multikicker: 'You may pay the extra cost any number of times as you cast it; the effect grows with each time.',
  flashback: 'You may cast it from your graveyard for its flashback cost. Then it’s exiled.',
  buyback: 'You may pay an extra cost as you cast it; then it goes back to your hand instead of the graveyard.',
  cycling: 'Pay the cycling cost and discard it to draw a card.',
  madness: 'If you discard it, you may cast it for its madness cost instead of putting it in your graveyard.',
  overload: 'You may cast it for its overload cost; then “target” becomes “each”.',
  convoke: 'Your creatures can help cast it: each one you tap pays {1} or one mana of its color.',
  delve: 'Each card you exile from your graveyard while casting it pays {1}.',
  improvise: 'Each artifact you tap while casting it pays {1}.',
  affinity: 'It costs {1} less for each of the named kind (usually artifacts) you control.',
  emerge: 'You may cast it by sacrificing a creature and paying the emerge cost, less that creature’s mana value.',
  evoke: 'You may cast it for its evoke cost. Then it’s sacrificed as it enters (its enter abilities still happen).',
  dash: 'You may cast it for its dash cost: it gets haste and returns to your hand at the end of the turn.',
  blitz:
    'You may cast it for its blitz cost: it gets haste and “when it dies, draw a card”, and is sacrificed at the end of the turn.',
  prowl: 'You may cast it for its prowl cost if a creature of its type dealt combat damage to a player this turn.',
  surge: 'You may cast it for its surge cost if you or a teammate cast another spell this turn.',
  spectacle: 'You may cast it for its spectacle cost if an opponent lost life this turn.',
  escape: 'You may cast it from your graveyard for its escape cost, which includes exiling other cards from there.',
  foretell: 'In your turn, pay {2} to exile it face down. On a later turn, cast it for its foretell cost.',
  disturb:
    'You may cast it from your graveyard transformed, for its disturb cost. If it would leave the battlefield, it’s exiled instead.',
  'jump-start': 'You may cast it from your graveyard by also discarding a card. Then it’s exiled.',
  retrace: 'You may cast it from your graveyard by also discarding a land card.',
  aftermath: 'Its second half can only be cast from your graveyard, and then it’s exiled.',
  splice:
    'As you cast a spell of the named type, you may reveal this and pay its splice cost to add its text to that spell.',
  entwine: 'For the entwine cost on top, you get every mode instead of one.',
  escalate: 'Pay the escalate cost for each mode you choose beyond the first.',
  replicate: 'Pay the replicate cost any number of times as you cast it; you get that many copies.',
  bargain: 'As you cast it, you may sacrifice an artifact, enchantment or token for an extra effect.',
  plot: 'In your turn, pay the plot cost to exile it face up. On a later turn, cast it for free as a sorcery.',
  spree: 'Choose one or more modes, paying each one’s extra cost.',
  freerunning:
    'You may cast it for its freerunning cost if an Assassin or your commander dealt combat damage to a player this turn.',
  offspring: 'You may pay the offspring cost as you cast it; when it enters, you get a 1/1 token copy of it.',
  gift: 'As you cast it, you may promise an opponent a gift (a card, a Food, a Fish…); if you do, you get an extra effect.',
  impending:
    'Cast it for its impending cost: it enters with time counters and isn’t a creature until the last one is removed, one each end step.',
  warp: 'Cast it for its warp cost from your hand: it’s exiled at the end of the turn, and you may cast it from exile later.',
  suspend:
    'Pay the suspend cost to exile it with time counters. One comes off each upkeep; at the last, cast it for free.',
  miracle: 'If it’s the first card you drew this turn, you may reveal it and cast it for its miracle cost.',
  ninjutsu:
    'Pay the ninjutsu cost and return an unblocked attacker you control to your hand: put this onto the battlefield tapped and attacking.',
  morph: 'You may cast it face down as a 2/2 for {3}. Turn it face up any time for its morph cost.',
  megamorph: 'Like morph, and it gets a +1/+1 counter when turned face up.',
  disguise:
    'You may cast it face down for {3}, as a 2/2 with ward {2}. Turn it face up any time for its disguise cost.',
  cleave: 'You may cast it for its cleave cost; then the words in square brackets are left out.',
  casualty: 'As you cast it, you may sacrifice a creature with at least the given power; then you copy the spell.',

  // Triggered and static abilities
  annihilator: 'Whenever it attacks, the defending player sacrifices that many permanents.',
  cascade:
    'When you cast it, exile cards from the top of your library until you hit a nonland card that costs less. You may cast that for free; the rest go to the bottom in a random order.',
  storm: 'When you cast it, copy it for each spell cast before it this turn.',
  exalted:
    'Whenever a creature you control attacks alone, it gets +1/+1 until end of turn for each instance of exalted you have.',
  'battle cry': 'Whenever it attacks, each other attacking creature gets +1/+0 until end of turn.',
  myriad:
    'Whenever it attacks, for each other opponent, create a token copy of it attacking that player (or their planeswalker). Exile the tokens at end of combat.',
  melee: 'Whenever it attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.',
  undying: 'When it dies, if it had no +1/+1 counters, return it to the battlefield with a +1/+1 counter.',
  persist: 'When it dies, if it had no −1/−1 counters, return it to the battlefield with a −1/−1 counter.',
  infect: 'It deals damage to creatures as −1/−1 counters and to players as poison counters.',
  wither: 'It deals damage to creatures as −1/−1 counters.',
  toxic: 'Combat damage it deals to a player also gives them that many poison counters.',
  poisonous: 'Whenever it deals combat damage to a player, they get that many poison counters.',
  afflict: 'Whenever it becomes blocked, the defending player loses that much life.',
  rampage: 'Whenever it becomes blocked, it gets +N/+N for each creature blocking it beyond the first.',
  flanking: 'Whenever a creature without flanking blocks it, the blocker gets −1/−1 until end of turn.',
  bushido: 'Whenever it blocks or becomes blocked, it gets +N/+N until end of turn.',
  dethrone: 'Whenever it attacks the player with the most life (or tied for it), it gets a +1/+1 counter.',
  renown:
    'When it deals combat damage to a player, if it isn’t renowned, it gets that many +1/+1 counters and becomes renowned.',
  training: 'Whenever it attacks with another creature with greater power, it gets a +1/+1 counter.',
  mentor: 'Whenever it attacks, put a +1/+1 counter on target attacking creature with less power.',
  riot: 'It enters with your choice of a +1/+1 counter or haste.',
  unleash: "It may enter with a +1/+1 counter. If it has one, it can't block.",
  evolve: 'Whenever a creature you control enters with greater power or toughness, put a +1/+1 counter on this.',
  modular:
    'It enters with that many +1/+1 counters. When it dies, you may move its +1/+1 counters onto an artifact creature.',
  graft: 'It enters with that many +1/+1 counters. Whenever another creature enters, you may move one onto it.',
  sunburst: 'It enters with a counter for each color of mana spent to cast it.',
  fabricate: 'When it enters, put that many +1/+1 counters on it, or create that many 1/1 Servo tokens.',
  outlast: 'Pay the cost and tap it: put a +1/+1 counter on it. Only as a sorcery.',
  scavenge:
    'Pay the scavenge cost and exile it from your graveyard: put +1/+1 counters equal to its power on a creature. Only as a sorcery.',
  unearth:
    'Pay the unearth cost: return it from your graveyard with haste. Exile it at the end of the turn, or if it would leave.',
  embalm:
    'Pay the embalm cost and exile it from your graveyard: create a token copy that’s a white Zombie. Only as a sorcery.',
  eternalize:
    'Pay the eternalize cost and exile it from your graveyard: create a 4/4 black Zombie token copy. Only as a sorcery.',
  encore:
    'Pay the encore cost and exile it from your graveyard: for each opponent, create a token copy that attacks them this turn and is sacrificed at the end.',
  echo: 'At the beginning of your upkeep after it enters, sacrifice it unless you pay its echo cost.',
  'cumulative upkeep':
    'Each upkeep, put an age counter on it, then pay the cost once per age counter, or sacrifice it.',
  vanishing: 'It enters with time counters. One comes off each upkeep; when the last one does, sacrifice it.',
  fading: 'It enters with fade counters. Remove one each upkeep; if you can’t, sacrifice it.',
  phasing: 'It phases in or out each untap step. Phased out, it’s treated as though it doesn’t exist.',
  dredge: 'Instead of drawing a card, you may mill that many cards and return this from your graveyard to your hand.',
  bloodthirst: 'If an opponent was dealt damage this turn, it enters with that many +1/+1 counters.',
  hideaway:
    'When it enters, look at the top cards of your library, exile one face down, and put the rest on the bottom. Its ability lets you play it later.',
  exploit: 'When it enters, you may sacrifice a creature, for its exploit effect.',
  extort: 'Whenever you cast a spell, you may pay {W/B}: each opponent loses 1 life and you gain that much.',
  cipher:
    'You may exile it encoded on a creature you control. Whenever that creature deals combat damage to a player, cast a copy for free.',
  soulbond: 'You may pair it with another unpaired creature when either enters; both get the bonus while paired.',
  'living weapon': 'When this Equipment enters, create a 0/0 black Phyrexian Germ token and attach it to that.',
  'umbra armor':
    'If the enchanted permanent would be destroyed, remove all damage from it and destroy this Aura instead.',
  'totem armor':
    'If the enchanted permanent would be destroyed, remove all damage from it and destroy this Aura instead.',
  rebound:
    'If you cast it from your hand, exile it as it resolves. At your next upkeep, you may cast it from exile for free.',
  'level up': 'Pay the cost to put a level counter on it, as a sorcery. It gets better at the levels shown.',
  bestow:
    'You may cast it as an Aura for its bestow cost. If the creature it’s on leaves, it becomes a creature again.',
  tribute: 'As it enters, an opponent may put that many +1/+1 counters on it. If they don’t, you get its other effect.',
  ingest: 'Whenever it deals combat damage to a player, they exile the top card of their library.',
  awaken:
    'You may cast it for its awaken cost: also turn a land you control into a 0/0 Elemental creature with haste and that many +1/+1 counters.',
  skulk: "It can't be blocked by creatures with greater power.",
  shadow: 'It can block or be blocked only by creatures with shadow.',
  horsemanship: "It can't be blocked except by creatures with horsemanship.",
  fear: "It can't be blocked except by artifact creatures and black creatures.",
  provoke: 'Whenever it attacks, you may have a creature the defending player controls untap and block it if able.',
  champion:
    'When it enters, sacrifice it unless you exile another creature of the named type. When it leaves, that card returns.',
  conspire: 'As you cast it, you may tap two untapped creatures you control that share a color with it to copy it.',
  devour: 'As it enters, you may sacrifice any number of creatures; it gets that many +1/+1 counters for each.',
  amplify:
    'As it enters, reveal any number of cards of its creature type from your hand; it gets that many +1/+1 counters for each.',
  haunt:
    'When it dies (or resolves, for a spell), exile it haunting a creature. When that creature dies, you get the effect again.',
  forecast: 'During your upkeep, you may reveal it from your hand and pay the cost for its effect, once a turn.',
  recover:
    'When a creature is put into your graveyard, you may pay the recover cost to return this to your hand; if you don’t, exile it.',
  ripple: 'When you cast it, reveal the top cards of your library; you may cast any with the same name for free.',
  frenzy: 'Whenever it attacks and isn’t blocked, it gets +N/+0 until end of turn.',
  gravestorm: 'When you cast it, copy it for each permanent put into a graveyard this turn.',
  transfigure:
    'Pay the cost and sacrifice it: search your library for a creature with the same mana value and put it onto the battlefield.',
  transmute: 'Pay the cost and discard it: search your library for a card with the same mana value. Only as a sorcery.',
  epic: "For the rest of the game you can't cast spells, but at each of your upkeeps you copy this spell.",
  reinforce: 'Pay the cost and discard it: put that many +1/+1 counters on a creature.',
  'aura swap': 'Pay the cost: exchange this Aura with an Aura card in your hand.',
  fortify: 'Pay the cost to attach this Fortification to a land you control. Only as a sorcery.',
  absorb: 'If a source would deal damage to it, prevent that much of it.',
  banding: 'It can attack in a band with others; its controller divides combat damage dealt to the band.',
  offering:
    'You may cast it any time you could cast an instant, by sacrificing a creature of the named type and paying the difference.',
  soulshift:
    'When it dies, you may return a Spirit card with that mana value or less from your graveyard to your hand.',
  undaunted: 'It costs {1} less for each opponent you have.',
  assist: 'Another player can help pay for the generic mana of its cost.',
  ascend: 'If you control ten or more permanents, you get the city’s blessing for the rest of the game.',
  afterlife: 'When it dies, create that many 1/1 white and black Spirit tokens with flying.',
  mutate:
    'Cast it on a non-Human creature you own for its mutate cost: they merge into one creature, with every ability.',
  boast: 'Its boast ability can be used only if it attacked this turn, and only once a turn.',
  demonstrate: 'When you cast it, you may copy it. If you do, an opponent copies it too.',
  daybound:
    'If it’s night, it becomes its nightbound side. Day and night switch with how many spells the active player casts.',
  nightbound:
    'If it’s day, it becomes its daybound side. Day and night switch with how many spells the active player casts.',
  decayed: "It can't block. When it attacks, sacrifice it at end of combat.",
  compleated:
    'You can pay Phyrexian mana with 2 life; for each one paid that way, it enters with two fewer loyalty counters.',
  reconfigure:
    'Pay the cost to attach it to a creature you control, or unattach it. Attached, it isn’t a creature. Only as a sorcery.',
  enlist:
    'As it attacks, you may tap a creature you control that isn’t attacking; it adds that creature’s power until end of turn.',
  'read ahead': 'As it enters, choose a chapter to start on. Abilities of skipped chapters don’t trigger.',
  ravenous: 'It enters with X +1/+1 counters. If X is 5 or more, draw a card when it enters.',
  squad:
    'You may pay the squad cost any number of times as you cast it; you get that many token copies when it enters.',
  prototype: 'You may cast it for its prototype cost, with the smaller power and toughness and colors shown.',
  'living metal': "As long as it's your turn, this Vehicle is also an artifact creature.",
  'more than meets the eye': 'You may cast it converted (its back side) for that cost.',
  'for mirrodin!': 'When this Equipment enters, create a 2/2 red Rebel token and attach this to it.',
  backup:
    'When it enters, put that many +1/+1 counters on target creature; if that’s another creature, it gets this card’s abilities until end of turn.',
  craft:
    'Pay the craft cost and exile it plus the materials named from the battlefield or your graveyard: return it transformed. Only as a sorcery.',
  'start your engines!':
    'You have speed (starting at 1). Once each of your turns, when an opponent loses life, your speed goes up by 1, to at most 4.',
  'max speed': 'It has these abilities while your speed is 4.',
  exhaust: 'Its exhaust ability can be activated only once.',
  harmonize:
    'You may cast it from your graveyard for its harmonize cost, tapping a creature to pay less; then it’s exiled.',
  mobilize:
    'Whenever it attacks, create that many tapped and attacking 1/1 red Warrior tokens. Sacrifice them at the next end step.',
  tiered: 'Choose one mode, paying its extra cost.',
  station: 'Tap another creature you control: put charge counters equal to its power on this. Only as a sorcery.',
  'job select': 'When this Equipment enters, create a 1/1 colorless Hero token and attach this to it.',
  'web-slinging': 'You may cast it for its web-slinging cost by returning a tapped creature you control to your hand.',

  // Keyword actions
  scry: 'Look at that many cards from the top of your library. Put any of them on the bottom and the rest back in any order.',
  surveil:
    'Look at that many cards from the top of your library. Put any of them into your graveyard and the rest back in any order.',
  mill: 'Put that many cards from the top of your library into your graveyard.',
  proliferate:
    'Choose any number of permanents and players with counters; give each another of each kind already there.',
  investigate: 'Create a Clue token: an artifact with “{2}, sacrifice this: draw a card”.',
  fight: 'Each of the two creatures deals damage equal to its power to the other.',
  goad: 'Until your next turn, the goaded creature attacks each combat if able, and attacks a player other than you if able.',
  populate: 'Create a token that’s a copy of a creature token you control.',
  explore:
    'Reveal the top card of your library. A land goes to your hand; otherwise it gets a +1/+1 counter and you may put that card into your graveyard.',
  connive: 'Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.',
  amass: 'Put that many +1/+1 counters on an Army you control; if you have none, create a 0/0 Army token first.',
  adapt: 'If it has no +1/+1 counters, put that many on it.',
  bolster: 'Put that many +1/+1 counters on the creature you control with the least toughness.',
  monstrosity: 'If it isn’t monstrous, put that many +1/+1 counters on it; it becomes monstrous.',
  support: 'Put a +1/+1 counter on each of up to that many other target creatures.',
  manifest:
    'Put the top card of your library onto the battlefield face down as a 2/2 creature. Turn it up for its mana cost if it’s a creature.',
  'manifest dread':
    'Look at the top two cards of your library; manifest one (face down, a 2/2) and put the other into your graveyard.',
  transform: 'Turn the double-faced card over to its other face.',
  meld: 'Exile the two named cards and put them onto the battlefield together, as one big card.',
  detain: 'Until your next turn, the permanent can’t attack or block, and its activated abilities can’t be activated.',
  exert: "An exerted creature won't untap during your next untap step.",
  learn:
    'You may reveal a Lesson card from outside the game and put it into your hand, or discard a card to draw a card.',
  'venture into the dungeon': 'Enter a dungeon’s first room, or move to the next room of the one you’re in.',
  incubate:
    'Create an Incubator token with that many +1/+1 counters. Pay {2} to turn it into a 0/0 Phyrexian artifact creature.',
  discover:
    'Exile cards from the top of your library until a nonland card with that mana value or less. Cast it for free, or put it in your hand.',
  'collect evidence': 'Exile cards with total mana value of at least that much from your graveyard.',
  suspect: 'A suspected creature has menace and can’t block.',
  forage: 'Exile three cards from your graveyard, or sacrifice a Food.',
  endure: 'Put that many +1/+1 counters on it, or create a 0/0 white Spirit token with that many +1/+1 counters.',
  clash: 'You and an opponent each reveal the top card of your libraries; you win if yours has the greater mana value.',
  fateseal:
    'Look at that many cards from the top of an opponent’s library; put any on the bottom and the rest back in any order.',
  vote: 'Each player votes, starting with you and going around.',
  assemble: 'Put the top card of your Contraption deck onto a sprocket.',
  'open an attraction': 'Put the top card of your Attraction deck onto the battlefield.',
  'roll to visit your attractions':
    'Roll a six-sided die; each Attraction you control lit up for that number does its thing.',
  'time travel':
    'For each suspended card you own and permanent you control with time counters, you may add or remove one.',
  cloak:
    'Put the card onto the battlefield face down as a 2/2 with ward {2}. Turn it up for its mana cost if it’s a creature.',
  'the ring tempts you':
    'Choose a Ring-bearer among your creatures. Each time, it gets another of the Ring’s abilities.',
  'villainous choice': 'An opponent chooses one of the two options, and it happens to them.',
  sacrifice: 'Put a permanent you control into its owner’s graveyard. It can’t be stopped by indestructible.',
  exile: 'Put it in the exile zone, out of the game unless something brings it back.',
  regenerate:
    'The next time it would be destroyed this turn, instead tap it, remove all damage from it and remove it from combat.',

  // Ability words: no rules meaning of their own, but they name the condition
  landfall: 'Whenever a land you control enters.',
  raid: 'If you attacked this turn.',
  metalcraft: 'As long as you control three or more artifacts.',
  threshold: 'As long as seven or more cards are in your graveyard.',
  delirium: 'As long as there are four or more card types among cards in your graveyard.',
  morbid: 'If a creature died this turn.',
  constellation: 'Whenever an enchantment you control enters.',
  heroic: 'Whenever you cast a spell that targets this creature.',
  magecraft: 'Whenever you cast or copy an instant or sorcery.',
  alliance: 'Whenever another creature you control enters.',
  coven: 'If you control three or more creatures with different powers.',
  revolt: 'If a permanent you controlled left the battlefield this turn.',
  ferocious: 'If you control a creature with power 4 or more.',
  formidable: 'If creatures you control have total power 8 or more.',
  hellbent: 'If you have no cards in hand.',
  domain: 'Counts the basic land types among lands you control.',
  'spell mastery': 'If there are two or more instants and sorceries in your graveyard.',
  inspired: 'Whenever this creature becomes untapped.',
  enrage: 'Whenever this creature is dealt damage.',
  battalion: 'Whenever this and at least two other creatures attack.',
  bloodrush:
    'Discard this and pay the cost: target attacking creature gets its power, toughness and abilities until end of turn.',
  channel: 'Pay the cost and discard this card for its effect.',
  'fateful hour': 'If you have 5 or less life.',
  grandeur: 'Discard another card with this name for the effect.',
  lieutenant: 'As long as you control your commander.',
  parley: 'Each player reveals the top card of their library; it counts the nonland cards revealed.',
  radiance: 'Affects each permanent that shares a color with the target too.',
  'join forces': 'Each player may pay any amount of mana to add to the effect.',
  'will of the council': 'Each player votes; the option with the most votes happens.',
  "council's dilemma": 'Each player votes; each option happens once per vote it got.',
  'tempting offer': 'Each opponent may take the offer too; for each who does, you get the effect again.',
  eminence: 'It works while this commander is in the command zone or on the battlefield.',
  'pack tactics': 'Whenever this attacks, if you attacked with creatures with total power 6 or more this combat.',
  celebration: 'If two or more nonland permanents entered under your control this turn.',
  descend: 'Counts the permanent cards in your graveyard (descend 4: if there are four or more).',
  'fathomless descent': 'Counts the permanent cards in your graveyard.',
  corrupted: 'If an opponent has three or more poison counters.',
  valiant: 'Whenever this becomes the target of a spell or ability you control, the first time each turn.',
  survival: 'At the beginning of your second main phase, if this creature is tapped.',
  eerie: 'Whenever an enchantment you control enters, and whenever you fully unlock a Room.',
  flurry: 'Whenever you cast your second spell each turn.',
  void: 'If a nonland permanent left the battlefield this turn, or a spell was warped this turn.',
  kinship:
    'At the beginning of your upkeep, look at the top card of your library; if it shares a creature type with this, you may reveal it.',
  chroma: 'Counts the colored mana symbols among the named cards.',
  imprint: 'It remembers the card exiled with it.',
  addendum: 'If you cast this spell during your main phase.',
  adamant: 'If at least three mana of one color was spent to cast it.',
  undergrowth: 'Counts the creature cards in your graveyard.',
  converge: 'Counts the colors of mana spent to cast it.',
  'secret council': 'Each player votes in secret, and the votes are revealed together.',
  cohort: 'Tap this and an untapped Ally you control for the effect.',
  strive: 'It costs more for each target beyond the first.',
  sweep: 'Return any number of lands of the named type to your hand; the effect counts them.',
  paradox: 'Whenever you cast a spell from anywhere other than your hand.',
};

/** The basic land types, for landwalk ("Islandwalk") and typecycling ("Swampcycling"). */
const KINDS = ['plains', 'island', 'swamp', 'mountain', 'forest', 'desert', 'basic land', 'land', 'wizard', 'slivers'];

/** What a keyword means, or undefined if it isn't one the app explains. */
export function keywordExplanation(keyword: string): string | undefined {
  const key = keyword.trim().toLowerCase();
  const known = KEYWORDS[key];
  if (known) return known;
  // Islandwalk, Swampwalk… and Islandcycling, Basic landcycling…
  if (key.endsWith('walk') && KINDS.some((kind) => key === `${kind}walk`)) {
    return `It can't be blocked as long as the defending player controls a ${key.slice(0, -4)}.`;
  }
  if (key.endsWith('cycling') && key !== 'cycling') {
    return `Pay the cost and discard it: search your library for a ${key.slice(0, -7)} card, reveal it and put it into your hand.`;
  }
  return undefined;
}
