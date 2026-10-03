/** Living house manuals. Defaults live in code; the house can edit or withdraw them. */

import { OPS_DEPARTMENTS, type OpsDepartment } from "./board.ts";

export const MANUAL_KINDS = ["APP", "SOP", "SAFETY", "LOOK", "HOSPITALITY"] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];
export type ManualStatus = "live" | "withdrawn";

export type ManualStep = { title: string; look: string; act: string; note?: string };
export type ManualNode = { title: string; caption: string };

export type ManualChapter = {
  slug: string;
  department: OpsDepartment;
  kind: ManualKind;
  title: string;
  summary: string;
  body: string;
  steps: ManualStep[];
  diagram: ManualNode[];
  sort_order: number;
};

export const MANUAL_KIND_LABEL: Record<ManualKind, string> = {
  APP: "How to use the house",
  SOP: "How the work is done",
  SAFETY: "Safety",
  LOOK: "How it should look",
  HOSPITALITY: "How we meet people",
};

export function isManualKind(v: unknown): v is ManualKind {
  return typeof v === "string" && (MANUAL_KINDS as readonly string[]).includes(v);
}

export function parseManualStatus(v: unknown): ManualStatus {
  return String(v ?? "").toLowerCase() === "withdrawn" ? "withdrawn" : "live";
}

export function chapterToPocketBody(ch: Pick<ManualChapter, "summary" | "body" | "steps">): string {
  const steps = ch.steps.map((s, i) =>
    `${i + 1}. ${s.title}\n   Look: ${s.look}\n   Act: ${s.act}${s.note ? `\n   Note: ${s.note}` : ""}`).join("\n\n");
  return `What it should look like\n${ch.summary}\n\nHow to act\n${ch.body}\n\nThe steps\n${steps}`;
}

export const HOUSE_MANUALS: ManualChapter[] = [
  {
    slug: "app-how-to-use",
    department: "HOUSE",
    kind: "APP",
    title: "How to use this house",
    sort_order: 10,
    summary: "Three doors, one house. The desk computer opens the House. A phone opens the Pocket. Guests open the Guest book. Nobody shares a login. There is no password — you are let in by your house email.",
    body: "This is the map of the app. Learn the doors first, then the page that belongs to your department. If a page is grey, your role does not open it — ask your head of department, do not borrow someone else's screen.\n\nHouse (desk): Today, House log, Front desk, Night porter, Department boards, Kitchen, Housekeeping, Maintenance, Payroll, Manual, Staff corner.\nPocket (phone): Clock, Holiday, Duty, House log, Front desk, Night, Manual, SOP.\nGuest book: the guest's own stay only. Never open House or Pocket in front of a guest.\n\nKiteline (kiteline.uk) is a different product. The published rota and PIN clock live there. Vedanta clock and the house duty board live here. Do not mix Kiteline PINs into this login.",
    diagram: [
      { title: "House", caption: "Desk · the full board" },
      { title: "Pocket", caption: "Phone · your shift" },
      { title: "Guest book", caption: "Guests · their stay only" },
    ],
    steps: [
      { title: "Sign in", look: "The forest-and-paper sign-in. Your name appears. No password box.", act: "Type your house email. Open House on a desk, Pocket on a phone.", note: "If the house has not added you yet, the door stays shut." },
      { title: "Clock", look: "Payroll (House) or Clock (Pocket) shows in or out.", act: "Clock in when you start. Clock out when you leave. Hours count from that." },
      { title: "Today", look: "Arrivals, rooms tonight, dinner covers.", act: "Read it before service. Front desk and Night porter both use who is arriving late." },
      { title: "House log", look: "Guest asks, daily ticks, handover notes, notices.", act: "Tick your round. Take a guest ask. Leave a note for the next shift instead of WhatsApp." },
      { title: "Front desk", look: "Today's water, tomorrow's fruit, teas, biscuits, Suma and organic wholesale.", act: "Order fruit and stock through the kitchen a day ahead." },
      { title: "Night porter", look: "Lock-up, late doors, tea station, morning handover.", act: "Walk the house twice. Let people in at the front door. Write the night note before you go." },
      { title: "Department boards", look: "Notes plus photographs of cupboards, machines, racks.", act: "Add a small picture so a new starter can find the thing. Keep photos under 500 KB." },
      { title: "Kitchen", look: "FOH orders land on the kitchen board.", act: "See the crate, mark seen, then done when mise includes it." },
      { title: "Manual", look: "This book — chapters by department, Look and Act side by side.", act: "Read your chapter. Mark it received on the Pocket. Heads of department may edit or withdraw a chapter." },
      { title: "Payroll and Staff", look: "Hours and duty in the house. Pay rates stay house-only.", act: "Never show a guest or the Pocket a pay rate." },
    ],
  },
  {
    slug: "app-receive-and-act",
    department: "HOUSE",
    kind: "APP",
    title: "How you receive an SOP, and how you act",
    sort_order: 20,
    summary: "A live chapter sits in Manual for anyone on the house. A sent SOP arrives on your Pocket under SOP with your name on it. Withdrawn chapters leave the Pocket. The paper look is the same: What it should look like, then How to act.",
    body: "Receive: when a head of department sends a chapter, it appears on your Pocket → SOP. You also always have Pocket → Manual for live chapters.\n\nRead: open it. Mark as read means I have received this and I know what it asks of me. That is the receipt.\n\nAct: do the Act column until the Look column is true. If you cannot finish, tick what you did on the House log and write a handover — do not leave a silent gap.\n\nChange: only sop.manage (general manager, operations, front office, housekeeping supervisor, and the roles given that key) can edit wording or withdraw a chapter. Withdrawn means it no longer teaches the house. Old receipts stay on the Pocket so we know who was taught the old version.\n\nNever invent a guest's allergen, room number in a public voice, or another guest's stay. If the manual and a guest disagree, stop and ask the head of department.",
    diagram: [
      { title: "Write", caption: "HoD edits the chapter" },
      { title: "Send", caption: "Lands on your Pocket" },
      { title: "Read", caption: "Mark received" },
      { title: "Act", caption: "Make the Look true" },
      { title: "Withdraw", caption: "Old teaching leaves the floor" },
    ],
    steps: [
      { title: "Find it", look: "House → Manual, or Pocket → Manual / SOP.", act: "Open your department first. Whole-house chapters sit under Whole house." },
      { title: "Receive", look: "An unread SOP on the Pocket has no read time.", act: "Read it on shift, not later at home if it is safety." },
      { title: "Mark received", look: "The button becomes gone; read time is stored.", act: "Press Mark as read only after you understand the Look and the Act." },
      { title: "Do the work", look: "The room, pass or desk matches the Look column.", act: "Follow Act. Tick the House log. Photograph the cupboard on the department board if a new person will need it." },
      { title: "Cannot finish", look: "A handover note exists for the next person.", act: "Write what stopped you. Do not hide a safety miss." },
    ],
  },
  {
    slug: "house-how-we-meet",
    department: "HOUSE",
    kind: "HOSPITALITY",
    title: "How we meet a guest",
    sort_order: 30,
    summary: "The house looks quiet, warm and unsurprised. A guest is greeted with the eyes first, then a smile, then their name if we know it. We never look busy at a person. We never discuss another guest.",
    body: "Hotels from Kyoto to Paris agree on this, and a retreat needs it more: the guest should feel they have arrived somewhere that already knew they were coming.\n\nOmotenashi (Japan): notice before they ask. A glass, a coat, a quiet path to the room.\nRitz-Carlton habit: use the name, own the problem, do not point — walk with them.\nIndian house habit: a slight greeting, no rush, no loud talk in the hall.\nEuropean hall: stand when a guest approaches the desk if you were sitting.\n\nSmile is not a performance. It is the face you have when you are glad they are here. If you are upset, step off the floor before the guest sees it.\n\nPrivacy is hospitality. Room numbers are never spoken in the lounge. Another guest's booking does not exist in your mouth.",
    diagram: [
      { title: "See", caption: "Eyes up, phone down" },
      { title: "Smile", caption: "Glad they are here" },
      { title: "Name", caption: "If we know it" },
      { title: "Help", caption: "Walk, do not point" },
      { title: "Leave", caption: "Quiet behind them" },
    ],
    steps: [
      { title: "Approach", look: "You are the first face. Phone is not in your hand.", act: "Stand or turn fully. 'Good morning' then the name. Wait for them to speak." },
      { title: "Listen", look: "You are not already reaching for a key.", act: "Hear the whole ask. Repeat the need once so they know you have it." },
      { title: "Fix", look: "The thing happens, or a real person is on it.", act: "If it is not your department, take it to the House log. Do not say 'that's not my job'." },
      { title: "Allergens and diet", look: "You never guess.", act: "Check the book. If unsure, kitchen or retreat manager — not a shrug." },
      { title: "Recovery", look: "The guest is not left holding the problem.", act: "Apologise once, fix it, tell the head of department. Do not argue the story." },
    ],
  },
  {
    slug: "front-desk-day",
    department: "FRONT",
    kind: "SOP",
    title: "Front of house — the day",
    sort_order: 40,
    summary: "The welcome desk is clear. Walkers and Nairn's (gluten-free) tins sit together, labelled. Plant milks in the fridge. Suma bags in the tin, loose teas from organic wholesale in the caddies. Today's water is in the urn. Cups on the restaurant rack are clean. The person at the desk looks up.",
    body: "Tea and coffee is run from reception. At 09:00 the coffee machines are cleaned, filters emptied and put on to clean. Dirty cups go to the wash as soon as you see them; clean cups come back to the restaurant.\n\nAlways ready: Walkers, gluten-free Nairn's, oat and soya or almond, dairy from the kitchen, bananas, herbal and loose teas. Order fruit and stock through the kitchen a day ahead — Front desk page, then Kitchen sees the order.\n\nThe seven waters live on Front desk. Look today and tomorrow. Make today's. Order tomorrow's fruit now.",
    diagram: [
      { title: "09:00", caption: "Machines and filters" },
      { title: "Cups", caption: "Dirty away, clean back" },
      { title: "Water", caption: "Today's recipe" },
      { title: "Stock", caption: "Teas, milk, biscuits" },
      { title: "Order", caption: "Kitchen, a day ahead" },
    ],
    steps: [
      { title: "Open the desk", look: "Sideboard dressed, names of arrivals known, keys ready.", act: "Read Today and Front desk. Tick Welcome desk on the House log." },
      { title: "Nine o'clock clean", look: "Machines empty, filters on to clean, no overnight grounds.", act: "Clean, empty filters, start the clean cycle. Tick the 09:00 lines." },
      { title: "Cups", look: "No dirty cup on a table. Restaurant racks full of clean.", act: "Carry dirty to the wash. Bring clean back. Do not stack wet on the sideboard." },
      { title: "Water", look: "Urn labelled with today's fruit. Ice only at service.", act: "Follow today's recipe. Order tomorrow's fruit from Front desk." },
      { title: "Stock", look: "Both biscuit tins full and labelled. Plant milks dated.", act: "Check Suma and loose caddies. Send a kitchen order if short." },
      { title: "Guests", look: "Greeted by name. Diet confirmed. House phone explained.", act: "Never say a room number in the lounge. Guest book is theirs alone." },
    ],
  },
  {
    slug: "night-porter",
    department: "NIGHT",
    kind: "SOP",
    title: "Night porter — the night",
    sort_order: 50,
    summary: "The house is locked and quiet. One person is findable at the front. Public lights are off; escape lights stay on. The tea station is reset for morning. A written night handover is waiting for whoever opens.",
    body: "The night porter is the house after the day team has gone home. Sit the front so a guest can find you, then walk the house — it is a round, not a desk job.\n\nHotels from London to hill stations run the same bones: two lock-ups, a late door, a tidy lounge, a note for morning. Here that means doors and windows, lights, letting people in and out without leaving the latch off, dirty cups to the wash, inventory of teas and cups, fill for morning, keys and lost property in the safe, then the handover.",
    diagram: [
      { title: "22:00", caption: "First lock-up" },
      { title: "Door", caption: "Let in, latch on" },
      { title: "01:00", caption: "Second round" },
      { title: "05:30", caption: "Tea station filled" },
      { title: "06:30", caption: "Note for morning" },
    ],
    steps: [
      { title: "First lock-up", look: "Every external door closed. Public windows caught.", act: "Walk the route on the Night porter board photographs. Double-check. Tick the 22:00 lines." },
      { title: "Lights", look: "Empty rooms dark. Stairs and fire exits lit.", act: "Turn off unused lights. Never kill escape lighting." },
      { title: "Guests after hours", look: "You are at the front door, not a latch left off.", act: "Know late arrivals from Today. Let them in and out. Log asks on the House log." },
      { title: "Second round", look: "The same doors still closed in the small hours.", act: "Walk again around 01:00. Fire exits clear." },
      { title: "Station", look: "Front organised. Tables wiped. Cups gone. Teas and milk ready.", act: "Inventory, fill, cups to the wash, valuables in the safe." },
      { title: "Handover", look: "A Night note on the House log for the morning receptionist.", act: "Who arrived late, what was unlocked, what ran out, who needed help. Then clock out." },
    ],
  },
  {
    slug: "hk-room",
    department: "HK",
    kind: "SOP",
    title: "Housekeeping — the room",
    sort_order: 60,
    summary: "A ready room looks unused and kind: bed to house standard, towels facing the same way, bathroom dry and stocked, bin empty, window checked, no cleaner in sight. Stay-over is lighter; departure is a full change and a supervisor look.",
    body: "Work like a European floor team with a Japanese finish: clean as you go, leave no trolley in a guest's eye-line, never enter if the guest is in the room without a clear invitation.\n\nStay-over: refresh, do not strip a bed that is still made unless they asked. Departure: full linen, supervisor inspects before Ready.\n\nChemicals stay labelled (COSHH). Never mix bleach and acid. Lost property goes to the house log and the safe — not a pocket.\n\nFaults: write them on Maintenance with the room or the building area before you mark the room inspected.",
    diagram: [
      { title: "Knock", caption: "Housekeeping — wait" },
      { title: "Bed", caption: "House standard" },
      { title: "Bath", caption: "Dry, stocked" },
      { title: "Fault", caption: "Maintenance board" },
      { title: "Ready", caption: "Supervisor on departures" },
    ],
    steps: [
      { title: "Enter", look: "Door open with your cart as a door-stop. Guest not surprised.", act: "Knock, say Housekeeping, wait. If they are in, ask when to return." },
      { title: "Bed and linen", look: "Even, tight, pillows facing the same way.", act: "Stay-over: tidy. Departure: full change. Landing cupboard: stay-over vs departure stacks — see the photographs." },
      { title: "Bathroom", look: "No hair, no smear on the glass, amenities filled.", act: "Clean, restock, report a drip on Maintenance." },
      { title: "Floor and air", look: "Vacuum lines or a dry mop, bin empty, window catch checked.", act: "Empty bins on the round. Walk corridors and landings." },
      { title: "Leave", look: "Room looks as if nobody just cleaned it.", act: "Trolley off the landing. Tick the House log. Never discuss who stayed in the room." },
    ],
  },
  {
    slug: "kitchen-brigade",
    department: "KITCHEN",
    kind: "SOP",
    title: "Kitchen — how the brigade works",
    sort_order: 70,
    summary: "The pass is clear. Each board has a colour and a job. The allergen board matches today's guests. The FOH crate is a real list, not a WhatsApp. Voices are short. Nobody crosses a raw board onto a ready plate.",
    body: "We take the French brigade for who owns what, Japanese mise for how a station looks before service, UK hygiene for temperatures, and the quiet of an Indian retreat kitchen for timing vegetarian and allergen plates without drama.\n\nHead chef / kitchen manager owns the pass and the allergen board.\nSous keeps the clock and the sections.\nChef de partie owns a section — they do not wander.\nCommis and assistants fetch, prep, and never send a plate.\nKitchen porter (plongeur) owns wash-up and the floor — the pass depends on them.\n\nFOH orders (waters, bananas, plant milk, biscuits) arrive on Kitchen. Treat them as mise for reception, not a favour.\n\nKiteline Ordering is how supplier food is bought. This House kitchen board is how the house talks to itself.",
    diagram: [
      { title: "Mise", caption: "Station set, Japan" },
      { title: "Section", caption: "Brigade, France" },
      { title: "Allergen", caption: "Board, UK 14" },
      { title: "Pass", caption: "One voice" },
      { title: "FOH crate", caption: "Reception mise" },
    ],
    steps: [
      { title: "Before service", look: "Fridges 0–5°C, freezer −18°C or below, probe wiped, boards dry.", act: "Log temps. Hands, apron, hair. Allergen board vs today's guests. Open the FOH crate." },
      { title: "During service", look: "Pass clear. Tickets or covers in one place. No unused knives in the sink.", act: "Call allergies out loud at the pass. Clean as you go. Hot hold above 63°C." },
      { title: "FOH orders", look: "Crate seen, then done, fruit for tomorrow pulled.", act: "Mark the order seen, then done. Do not leave reception guessing." },
      { title: "After service", look: "Food labelled, cool within 90 minutes, walk-in locked.", act: "Follow Kitchen closing. Waste logged. Lights and non-essential kit off." },
    ],
  },
  {
    slug: "kitchen-safety",
    department: "KITCHEN",
    kind: "SAFETY",
    title: "Kitchen — safety and allergens",
    sort_order: 80,
    summary: "A safe kitchen looks dull: dry floors, handles in, lids on, fire cloth in reach, raw and ready apart, allergen board honest. Nobody runs. Nobody tastes from a guest plate and sends it.",
    body: "This is the hotel and UK food-hygiene core. It is not optional and it is not 'for environmental health day'.\n\nTemperature: fridge 0–5°C, freezer −18°C or below, cook to a safe core, hot hold above 63°C, cool from hot to cold in 90 minutes, then fridge.\n\nFourteen allergens (UK): celery, cereals with gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, peanut, sesame, soya, sulphur dioxide, tree nuts. If you do not know, the plate does not leave.\n\nColour boards stay in their colour. Wash hands after raw, after allergen work, after bins, after face or phone.\n\nFire: never throw water on oil. Lid, cloth, extinguisher you are trained for. Knives: down, not in a sink of water. Slips: mop and sign, then dry.\n\nBurns and cuts: cold water, tell the head chef, write it. Do not hide an injury to 'finish service'.",
    diagram: [
      { title: "Hands", caption: "Wash, then work" },
      { title: "Boards", caption: "Colour stays colour" },
      { title: "Heat", caption: "63° · 90 minutes" },
      { title: "Allergen", caption: "If unsure, stop" },
      { title: "Fire / oil", caption: "Lid, never water" },
    ],
    steps: [
      { title: "Hands and kit", look: "Clean apron, tied hair, no jewellery that traps food.", act: "Wash, dry, glove only when the job needs it — gloves are not a substitute for washing." },
      { title: "Separation", look: "Raw below ready in the fridge. Allergen mise on its own tray.", act: "Never use a tasting spoon twice. Never 'just pick out' the nuts." },
      { title: "Heat and cold", look: "Temps written. Probe clean.", act: "Log opening temps. Probe the thickest part. Cool in shallow pans." },
      { title: "Oil and fire", look: "Pan handles in. Cloth on the rail. Exit clear.", act: "Lid on a flare. Shout. Do not carry a burning pan through the pass." },
      { title: "Floor and knives", look: "Dry floor, knives visible in the block or on the magnet.", act: "Mop, sign, dry. Never leave a knife in the wash-up water." },
      { title: "If someone is hurt", look: "The line has stopped for that person.", act: "First aid, head chef, record. Service waits." },
    ],
  },
  {
    slug: "kitchen-open-close",
    department: "KITCHEN",
    kind: "SOP",
    title: "Kitchen — opening and closing",
    sort_order: 90,
    summary: "Opening looks ready twenty minutes before the first plate. Closing looks as if the next chef could cook without asking where yesterday went.",
    body: "Opening: temps, hands, allergen board, dry store, FOH crate, hot-hold, probe.\nClosing: cool and label, sanitise, waste, bins, fridge doors, lights, lock dry store and walk-in.\n\nThese two checks already sit as short SOPs on the Pocket. This chapter is the fuller Look and Act. Heads of kitchen may edit the wording when the menu or the kit changes.",
    diagram: [
      { title: "Open", caption: "Temps · allergens · crate" },
      { title: "Service", caption: "Pass · 63°" },
      { title: "Close", caption: "Cool · lock" },
    ],
    steps: [
      { title: "Open", look: "Logged temps, board matches the book, FOH fruit pulled.", act: "Tick Kitchen opening on the House log. Raise a FOH shortage as an order, not a shout." },
      { title: "Close", look: "Nothing unnamed in a fridge. Floor dry. Door locked.", act: "Tick Kitchen closing. Handover if something failed a temp — do not hide it." },
    ],
  },
  {
    slug: "restaurant-service",
    department: "RESTAURANT",
    kind: "SOP",
    title: "Restaurant — the room",
    sort_order: 100,
    summary: "Tables even, glasses at the same height, napkins the house way, water poured without asking twice, allergen spoken at the table not across the room. The pass is thanked, not shouted at.",
    body: "Classic European service sequence, quiet enough for a retreat: greet, water, diet check, serve ladies or the host as the table prefers, clear from the right if that is the house way and stay consistent, never scrape plates at the table.\n\nTea station after breakfast is shared with Front of house — clean cups live on the restaurant racks. If FOH is short, you restock from wash-up, not from dirty tables.\n\nWine and water: hold the label, never reach across a face. Spill: own it, replace, tell the manager. Do not make the guest feel clumsy.",
    diagram: [
      { title: "Set", caption: "Even, quiet, ready" },
      { title: "Greet", caption: "Name if we know it" },
      { title: "Diet", caption: "At the table, low voice" },
      { title: "Serve", caption: "One house way" },
      { title: "Clear", caption: "No scrape" },
    ],
    steps: [
      { title: "Briefing", look: "Whole team knows covers, allergens, and who is celebrating nothing loudly.", act: "Tick Service briefing. Read the kitchen allergen board." },
      { title: "Meet the table", look: "You arrived before they had to wave.", act: "Smile, name, water, diet. Never announce an allergy to the next table." },
      { title: "Pass", look: "Hot food travels covered if the walk is long.", act: "Allergy plates in your hand, not on a stacked tray with other food." },
      { title: "After", look: "Room reset, cups on the racks, no dirty glass in the lounge.", act: "Help FOH if the tea station is short. Write a handover if a guest was unhappy." },
    ],
  },
  {
    slug: "maint-faults",
    department: "MAINT",
    kind: "SOP",
    title: "Maintenance — faults and plant",
    sort_order: 110,
    summary: "A fault on the board has a clear title, a place (room or building area), a reporting department, and a priority. Safety is red. A locked-out room is honest. Plant looks labelled, not mysterious.",
    body: "Hotel engineering habit: if it is not written, it did not happen. Walk the boiler and plant, lights and fire doors, entrance safe — those ticks are on the House log every day.\n\nSafety if anyone could be hurt. Urgent if a room or service is blocked. Tick 'room can't be used' only when it must come off the board.\n\nPhotographs of valve tags and the fire-door map live on the Night porter and Maintenance department boards so a night porter can find a stopcock without waking the estate at 2 a.m. unless they must.",
    diagram: [
      { title: "See", caption: "What is wrong" },
      { title: "Write", caption: "Where · who · priority" },
      { title: "Make safe", caption: "Then repair" },
      { title: "Close", caption: "Tell the reporter" },
    ],
    steps: [
      { title: "Report", look: "The card can be read by someone who was not there.", act: "Title, room or area, department, priority. No private guest names on a shared card." },
      { title: "Daily walk", look: "Plant quiet, fire doors not wedged, entrance safe.", act: "Tick the Maintenance round. Photograph a new tag on the department board." },
      { title: "Night call", look: "Night porter can find the first stopcock from a picture.", act: "Keep the board photos honest. If it is safety, they wake you." },
    ],
  },
  {
    slug: "grounds-estate",
    department: "GROUNDS",
    kind: "SOP",
    title: "Estate and grounds — the walk",
    sort_order: 120,
    summary: "The drive is clear, the lakeside path is honest about mud, tools are away, guests are greeted if they pass you but never delayed by a machine in their only path.",
    body: "Car park and entrance, lakeside path, hose points, salt bin — the House log already names the daily walk. Work around the house, not through a silent retreat.\n\nMachines yield to a guest. Fuel and chemicals stay labelled and locked. If a path is unsafe, cone it and tell Front of house so they can warn arrivals.\n\nFOH water fruit is kitchen mise, not a grounds pick unless the garden has been asked.",
    diagram: [
      { title: "Entrance", caption: "Clear, kind" },
      { title: "Path", caption: "Walk it" },
      { title: "Tools", caption: "Away, locked" },
      { title: "Tell FOH", caption: "If a path is shut" },
    ],
    steps: [
      { title: "Morning", look: "Cars can land. No hose across the door.", act: "Tick Car park and entrance. Greet, then step aside." },
      { title: "Path", look: "You have walked it, not assumed it.", act: "Tick Lakeside path. Report a fault or a fallen branch." },
      { title: "Guests", look: "A tractor is not the welcome.", act: "Stop, smile, let them pass. No radio chatter about who is staying." },
    ],
  },
  {
    slug: "mgmt-the-board",
    department: "MGMT",
    kind: "SOP",
    title: "Management — the board and the book",
    sort_order: 130,
    summary: "The house has one log, one manual, one duty board. WhatsApp is not a record. Pay stays in the house. Guests never see staff hours.",
    body: "You edit manuals, withdraw teaching that is wrong, place people on AM / PM / Night, and sign holiday (heads of department first, then general manager).\n\nComplaints, invoices and manager asks route to Management on the House log. Do not leave a complaint only in a private message.\n\nKiteline remains the published rota. This house holds the duty board and the Vedanta clock so night and day can hand over on the same page.",
    diagram: [
      { title: "Manual", caption: "Edit or withdraw" },
      { title: "Duty", caption: "AM · PM · Night" },
      { title: "Log", caption: "One place" },
      { title: "Pay", caption: "House only" },
    ],
    steps: [
      { title: "Teach", look: "The live chapter matches how the house actually works.", act: "Edit Manual. Send to the Pocket when people must receipt it. Withdraw the old one." },
      { title: "Cover", look: "Night is a real slot, not a missing person.", act: "Place Night on Staff corner. Check Payroll against the clock." },
      { title: "Guest trouble", look: "A Management card exists, not a rumour.", act: "Take the ask on the House log. Recover with the guest, then the team." },
    ],
  },
  {
    slug: "app-report-a-problem",
    department: "HOUSE",
    kind: "APP",
    title: "Reporting a problem, and how it gets fixed",
    sort_order: 25,
    summary: "Every fault has one card. It says what is wrong, exactly where, and how urgent. The General Manager sees it on Manager view the moment it is sent, gives it to someone, and the reporter can watch it move from New to Being fixed to Fixed.",
    body: "Staff report from Staff hub → Report a problem. Pick what kind of problem it is, say where (room number or building area), and choose how urgent: Right now (someone could be hurt, or a guest cannot use their room), Today (it blocks work or a room later today), This week (it can wait for the next maintenance round).\n\nThe card lands on Maintenance tasks and on Manager view. The General Manager or a manager gives it to the right person — maintenance, grounds, or an outside contractor — and can block a room from bookings until it is safe.\n\nThe person fixing it presses Start work, then Mark fixed. The reporter sees the status under Problems I've reported. A manager may verify the repair.\n\nNever put a guest's name or health details on a fault card. If it is dangerous right now, make the area safe and tell a manager in person as well as on the card.",
    diagram: [
      { title: "See", caption: "What is wrong" },
      { title: "Report", caption: "Staff hub" },
      { title: "Assign", caption: "Manager view" },
      { title: "Fix", caption: "Start → Fixed" },
      { title: "Close", caption: "Reporter sees it" },
    ],
    steps: [
      { title: "Make safe first", look: "Nobody can slip, touch a live wire or walk into the hazard.", act: "Sign, cone, switch off at the local isolator if trained, or keep people away. Then report." },
      { title: "Write one clear card", look: "Someone who was not there can find it and understand it.", act: "Kind of problem, exact place, a few words on what is happening. Add a photo if it helps." },
      { title: "Choose urgency honestly", look: "Right now is rare and means it.", act: "Right now = danger or a guest room unusable. Today = blocks work. This week = can wait." },
      { title: "Manager assigns", look: "Every New card has an owner within the shift.", act: "General Manager or duty manager opens Manager view, gives the job to someone, blocks the room if needed." },
      { title: "Fix and close", look: "Status shows Fixed and the reporter can see it.", act: "Press Start work when you begin and Mark fixed when it is done. Tell the reporter if the guest is waiting." },
    ],
  },
  {
    slug: "front-group-arrival",
    department: "FRONT",
    kind: "SOP",
    title: "Front of house — a group arriving",
    sort_order: 125,
    summary: "When a group walks in, the welcome is ready before the coach is: room list printed and checked against the room board, keys in named envelopes, diets confirmed with the kitchen, tea out, the organiser met by name. Nobody queues for long and nobody's room is a surprise.",
    body: "The day before: open the booking, check numbers against the room list, confirm every room is Ready or scheduled to be, and check the kitchen has every dietary need and allergy. Print or prepare the arrival list and key envelopes.\n\nOn the day: the organiser is the first person you greet. Agree any changes with them, not with individual guests in the queue. Late arrivals and early arrivals are written on the House log so the night porter and housekeeping know.\n\nAllergies are confirmed privately with each guest who has one — never read out across the lobby. If a room is not ready, offer the lounge, tea and luggage storage, and give a realistic time. Do not promise what housekeeping has not confirmed.\n\nAfter the last guest: update the room board, note who has not arrived, and hand over to the next shift.",
    diagram: [
      { title: "Day before", caption: "Rooms · diets · keys" },
      { title: "Organiser", caption: "Greet first" },
      { title: "Check-in", caption: "Name · key · diet" },
      { title: "Settle", caption: "Tea · tour · times" },
      { title: "Handover", caption: "Who is still to come" },
    ],
    steps: [
      { title: "The day before", look: "Room list matches the room board. Kitchen has every diet.", act: "Check numbers, rooms, diets and arrival time with the organiser. Prepare key envelopes by name." },
      { title: "Ready the lobby", look: "Tea and water out, arrival list in hand, desk clear.", act: "Ask housekeeping which rooms are Ready. Agree a plan for any that are not." },
      { title: "Meet the organiser", look: "The organiser feels looked after first.", act: "Greet by name, confirm numbers and changes, agree timings for meals and the first session." },
      { title: "Check each guest in", look: "Under two minutes each, no queue out of the door.", act: "Name, key, room, meal times, Wi-Fi. Confirm any allergy quietly and that the kitchen has it." },
      { title: "If a room is not ready", look: "The guest is comfortable, not standing in a corridor.", act: "Offer the lounge, tea and luggage storage. Give a time housekeeping has confirmed." },
      { title: "Close the arrival", look: "Room board and House log are true.", act: "Mark arrivals in, list no-shows, write late arrivals for the night porter, hand over." },
    ],
  },
  {
    slug: "front-departure-billing",
    department: "FRONT",
    kind: "SOP",
    title: "Front of house — departures and settling the bill",
    sort_order: 126,
    summary: "A good departure is calm: the bill is right before the guest asks, keys come back, lost property is checked, housekeeping knows the room is free, and the organiser leaves with nothing outstanding and a reason to come back.",
    body: "The evening before: check the folio for each departing booking — extras added, deposits applied, nothing missing. Agree with the organiser who pays what (organiser account, individual extras).\n\nOn the morning: collect keys, take payment for anything outstanding, and send the receipt by email. Tell housekeeping as each room is vacated so turnaround can start — do not wait for the whole group.\n\nIf a guest disputes a charge, listen, check the folio together, and correct genuine mistakes on the spot. Anything you cannot resolve goes to the duty manager — do not argue at the desk.\n\nNever show one guest another guest's bill, room or contact details.",
    diagram: [
      { title: "Night before", caption: "Folio checked" },
      { title: "Keys", caption: "Back and counted" },
      { title: "Pay", caption: "Receipt by email" },
      { title: "Room free", caption: "Tell housekeeping" },
      { title: "Goodbye", caption: "Organiser first" },
    ],
    steps: [
      { title: "Check folios the night before", look: "Every departing folio is complete and correct.", act: "Add missing extras, apply deposits, agree organiser vs individual charges." },
      { title: "Keys and rooms", look: "All keys back, each vacated room passed to housekeeping.", act: "Count keys against the room list. Mark rooms vacated as they come back." },
      { title: "Take payment", look: "Nothing outstanding unless agreed in writing.", act: "Take card or confirm the invoice route. Email the receipt." },
      { title: "Disputes", look: "Calm, private, resolved or escalated.", act: "Go through the folio together. Fix genuine errors. Escalate the rest to the duty manager." },
      { title: "Lost property and goodbye", look: "Nothing left behind; the organiser thanked.", act: "Ask about valuables in safes. Log lost property. Thank the organiser and mention rebooking." },
    ],
  },
  {
    slug: "hk-turnaround",
    department: "HK",
    kind: "SOP",
    title: "Housekeeping — same-day turnaround between groups",
    sort_order: 65,
    summary: "When one group leaves and another arrives the same day, the team works to a plan, not a rush: departure rooms are cleaned in the order the new group needs them, each room is inspected before it is marked Ready, and front of house always knows the true count.",
    body: "Before checkout: the supervisor lists the rooms in priority order — rooms needed first by the arriving group, accessible rooms, rooms with special set-up (twin to double, extra bed, welcome pack). Linen, amenities and trolleys are stocked before the first room is free.\n\nAs rooms empty: front of house tells housekeeping room by room. Strip, air, clean, make, restock, check for faults and lost property. Report faults on the card before marking the room inspected.\n\nInspection: a supervisor or trained attendant checks every departure room before it becomes Ready. Ready means a guest could walk in now.\n\nIf the clock is against you: tell the supervisor early, not at five to three. The supervisor can move staff, ask the duty manager for help, or agree with front of house which rooms will be late.",
    diagram: [
      { title: "Plan", caption: "Order of rooms" },
      { title: "Stock", caption: "Linen · trolleys" },
      { title: "Clean", caption: "Room by room" },
      { title: "Inspect", caption: "Then Ready" },
      { title: "Tell FOH", caption: "True count" },
    ],
    steps: [
      { title: "Plan the order", look: "A written list: which rooms first, and who does each.", act: "Supervisor ranks rooms by the arriving group's needs and splits them between attendants." },
      { title: "Stock up first", look: "Trolleys full before checkout time.", act: "Linen, towels, amenities, welcome packs and any special items ready on each floor." },
      { title: "Clean as rooms free", look: "No attendant waiting idle for a whole group to leave.", act: "Start each room as soon as front of house marks it vacated." },
      { title: "Faults and lost property", look: "Nothing hidden, nothing pocketed.", act: "Report faults on the card. Log lost property and take it to the safe." },
      { title: "Inspect, then Ready", look: "Only inspected rooms show Ready on the room board.", act: "Supervisor checks each room and marks it Ready. Fix anything missed straight away." },
      { title: "Running late", look: "Front of house hears early and plans for it.", act: "Tell the supervisor as soon as a room will miss its time. Agree which rooms go first." },
    ],
  },
  {
    slug: "kitchen-allergen-plate",
    department: "KITCHEN",
    kind: "SAFETY",
    title: "Kitchen — making and sending an allergen plate",
    sort_order: 85,
    summary: "An allergen plate is made on its own, from checked ingredients, with clean kit, labelled and carried by hand to the right guest. It never shares a tray, a spoon or a guess. If anyone is unsure, it does not leave the pass.",
    body: "Information: the guest's allergy comes from the booking and is confirmed at check-in. The kitchen keeps the list for every meal. A new allergy mentioned at the table is passed to the kitchen before anything is served.\n\nIngredients: check the label or recipe for every component, including stocks, sauces, garnishes and oils. Watch for 'may contain' warnings. If a supplier has changed a product, check the new label.\n\nMaking: clean the area, wash hands, use clean boards, pans and utensils. Make the allergen plate first or in a separate area. Cover it and label it with the guest's name or table and the allergen.\n\nService: the chef calls it at the pass. The server carries it by hand, alone, to the right guest and names the dish. If a plate is wrong or contaminated, it is remade from the start — never 'picked off'.\n\nIf a guest has a reaction: call for help, call 999 if there are signs of a severe reaction, and help the guest use their own adrenaline auto-injector if they have one. Tell the duty manager and record what happened.",
    diagram: [
      { title: "Know", caption: "Allergy list per meal" },
      { title: "Check", caption: "Every label" },
      { title: "Make apart", caption: "Clean kit" },
      { title: "Label", caption: "Name · allergen" },
      { title: "Carry by hand", caption: "Alone, to the guest" },
    ],
    steps: [
      { title: "Read the list", look: "Every allergy for this meal is on the board before prep.", act: "Head chef checks the board against the bookings. New allergies from the floor go on immediately." },
      { title: "Check every ingredient", look: "Labels read, including sauces and garnishes.", act: "Check the recipe and labels. Treat 'may contain' as contains for that guest." },
      { title: "Make it apart", look: "Clean board, clean pan, washed hands, separate space.", act: "Prepare allergen plates first or in a separate area. Never share oil or utensils." },
      { title: "Cover and label", look: "The plate says who it is for and what it is free from.", act: "Cover, label with name or table and the allergen, keep it apart at the pass." },
      { title: "Hand it over", look: "The server carries one plate, by hand, to one guest.", act: "Call it at the pass. Server names the dish to the guest. Never on a shared tray." },
      { title: "If in doubt", look: "Nothing uncertain leaves the kitchen.", act: "Stop, check, remake. If a guest reacts: help, 999 for a severe reaction, tell the manager, record it." },
    ],
  },
  {
    slug: "house-service-recovery",
    department: "HOUSE",
    kind: "HOSPITALITY",
    title: "When a guest is unhappy — putting it right",
    sort_order: 35,
    summary: "An unhappy guest is listened to properly, thanked for telling us, and given a fix they can see. Whoever hears the complaint owns it until it is solved or clearly handed to someone who will.",
    body: "Listen without interrupting or defending. Repeat back what you heard so the guest knows you understood. Thank them for telling us — most unhappy guests never do.\n\nApologise for how it felt, even before you know whose fault it was. Then fix what you can straight away: move the room, replace the dish, send maintenance, bring the extra blanket. Tell the guest exactly what will happen and when.\n\nIf you cannot fix it, bring in the duty manager — and introduce them so the guest does not repeat the story. Write it on the House log so the next shift knows, and follow up later the same day to check it is still right.\n\nOnly a manager agrees refunds or money off. Never blame a colleague or another department in front of a guest.",
    diagram: [
      { title: "Listen", caption: "All of it" },
      { title: "Thank", caption: "For telling us" },
      { title: "Fix", caption: "Something visible" },
      { title: "Follow up", caption: "Same day" },
    ],
    steps: [
      { title: "Listen", look: "The guest has finished speaking and feels heard.", act: "Stop what you are doing, face them, let them finish, repeat it back." },
      { title: "Apologise and thank", look: "Calm voice, no excuses, no blame.", act: "Say sorry for the experience and thank them for telling you." },
      { title: "Fix what you can now", look: "The guest sees something happen.", act: "Act within your role straight away and tell them what you are doing and when it will be done." },
      { title: "Bring in a manager if needed", look: "The guest does not have to tell the story twice.", act: "Introduce the duty manager and summarise. Refunds or discounts are a manager's decision." },
      { title: "Record and follow up", look: "The next shift knows; the guest is checked on.", act: "Write it on the House log. Check back later that day that it is still right." },
    ],
  },
  {
    slug: "house-fire-evacuation",
    department: "HOUSE",
    kind: "SAFETY",
    title: "Fire alarm — what every person does",
    sort_order: 30,
    summary: "When the alarm sounds, everyone leaves by the nearest safe exit to the assembly point on the fire notice — staff included. Nobody goes back for belongings. The fire marshal or duty manager takes the count and meets the fire service.",
    body: "This chapter is the everyday summary. The house fire risk assessment, fire notices and your fire training are the authority — follow them where they say more.\n\nIf you find a fire: raise the alarm at the nearest call point, call 999, and only tackle a small fire if you are trained and it is safe. Close doors behind you to slow the fire.\n\nWhen the alarm sounds: stop work, switch off cooking equipment only if it is safe and quick, and guide guests to the nearest safe exit. Do not use lifts. Help anyone who needs assistance as set out in their personal evacuation plan.\n\nAt the assembly point: report to the fire marshal or duty manager. Front of house brings the current guest list; the duty manager brings the staff list from the time clock. Report anyone known to be missing and where they were last seen. Nobody re-enters until the fire service says it is safe.\n\nNight: the night porter leads the evacuation, calls 999, and meets the fire service.",
    diagram: [
      { title: "Alarm", caption: "Call point · 999" },
      { title: "Leave", caption: "Nearest safe exit" },
      { title: "Assemble", caption: "As on the fire notice" },
      { title: "Count", caption: "Guests and staff" },
      { title: "Wait", caption: "Fire service decides" },
    ],
    steps: [
      { title: "Find a fire", look: "Alarm raised within seconds.", act: "Press the nearest call point, call 999, close doors. Only use an extinguisher if trained and safe." },
      { title: "Alarm sounds", look: "Everyone moving to the nearest safe exit, calmly.", act: "Stop work, guide guests out, do not use lifts, do not collect belongings." },
      { title: "Help others", look: "Anyone who needs help has someone with them.", act: "Follow each person's evacuation plan. Report anyone you could not reach to the marshal." },
      { title: "Count", look: "Every guest and staff member accounted for.", act: "Front of house: guest list. Duty manager: staff on the time clock. Report missing people." },
      { title: "Do not go back", look: "Nobody re-enters the building.", act: "Wait until the fire service says it is safe. The duty manager decides when guests return." },
    ],
  },
  {
    slug: "house-medical-emergency",
    department: "HOUSE",
    kind: "SAFETY",
    title: "Someone is hurt or taken ill",
    sort_order: 32,
    summary: "In a medical emergency the person gets help first: a first aider or 999 within moments, someone staying with them, a clear way in for the ambulance, and a manager told. Paperwork comes after.",
    body: "Your first aid training is the authority. This is what the house expects around it.\n\nIf someone is seriously ill or injured — not breathing normally, unconscious, severe bleeding, chest pain, signs of a stroke or a severe allergic reaction — call 999 straight away, then call a first aider. If the person is not breathing normally, start CPR if trained and send someone for the defibrillator.\n\nFor anything less serious, call a first aider and the duty manager.\n\nOne person stays with the casualty. Another meets the ambulance at the entrance and guides the crew. Keep other guests calm and give the person privacy.\n\nAfterwards: record the incident in the accident book or incident record and tell the duty manager. Some injuries must be reported under RIDDOR — the manager decides. Never share a guest's health details beyond the people who need them.",
    diagram: [
      { title: "Danger", caption: "Make it safe" },
      { title: "Call", caption: "999 · first aider" },
      { title: "Stay", caption: "With the person" },
      { title: "Guide", caption: "Meet the ambulance" },
      { title: "Record", caption: "Incident record" },
    ],
    steps: [
      { title: "Check for danger", look: "You are not putting yourself at risk.", act: "Make the area safe before you approach." },
      { title: "Call for help", look: "999 called for anything serious; a first aider on the way.", act: "Call 999 first if it is serious, then a first aider and the duty manager." },
      { title: "Stay with them", look: "The person is never left alone.", act: "Follow your first aid training. Start CPR and get the defibrillator if they are not breathing normally." },
      { title: "Guide the ambulance", look: "Someone is waiting at the entrance.", act: "Send a colleague to meet the crew and bring them straight to the person." },
      { title: "Record and protect privacy", look: "The incident is written down; health details stay private.", act: "Complete the incident record. Tell the duty manager. Share health details only with those who need them." },
    ],
  },
];

export function manualsForDepartment(code: string, chapters: ManualChapter[] = HOUSE_MANUALS): ManualChapter[] {
  return chapters.filter(c => c.department === code).sort((a, b) => a.sort_order - b.sort_order);
}

export function defaultManual(slug: string): ManualChapter | undefined {
  return HOUSE_MANUALS.find(c => c.slug === slug);
}

export function manualDepartments(): { code: string; label: string }[] {
  const used = new Set(HOUSE_MANUALS.map(c => c.department));
  return OPS_DEPARTMENTS.filter(d => used.has(d.code)).map(d => ({ code: d.code, label: d.label }));
}
