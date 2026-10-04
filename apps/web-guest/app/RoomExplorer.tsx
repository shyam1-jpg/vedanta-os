"use client";
import { useState } from "react";
import { EMPTY_ROOM_FILTERS, filterRooms, roomOptions, roomSelection, toggleComparison, type AvailableRoom, type RoomFilters, type RoomSort } from "./room-options";

const PAGE_SIZE = 6;

export default function RoomExplorer({ rooms, guests, requested, onChange, onContinue }: {
  rooms: AvailableRoom[]; guests: number; requested: string[];
  onChange: (numbers: string[]) => void; onContinue: () => void;
}) {
  const [filters, setFilters] = useState<RoomFilters>(EMPTY_ROOM_FILTERS);
  const [sort, setSort] = useState<RoomSort>("room");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const matches = filterRooms(rooms, filters, guests, sort);
  const selection = roomSelection(rooms, requested, guests);
  const compared = rooms.filter(room => compare.includes(room.number));
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const setFilter = <K extends keyof RoomFilters>(key: K, value: RoomFilters[K]) => { setFilters(f => ({ ...f, [key]: value })); setLimit(PAGE_SIZE); };
  const reset = () => { setFilters(EMPTY_ROOM_FILTERS); setLimit(PAGE_SIZE); };
  const toggleRoom = (number: string) => onChange(requested.includes(number) ? requested.filter(n => n !== number) : [...requested, number]);

  return <section className="room-explorer" aria-labelledby="room-explorer-title">
    <div className="room-explorer-heading">
      <div><p className="section-kicker">Make room for your stay</p><h3 id="room-explorer-title">Find your kind of quiet.</h3></div>
      <p>Explore individual rooms, compare their listed details and request one or several rooms for your party. Your choices are not held or confirmed yet.</p>
    </div>
    <details className="room-filters" open>
      <summary>Refine your room search{activeFilters > 0 && <span>{activeFilters} active</span>}</summary>
      <div className="room-filter-grid">
        <label>Room type<select value={filters.type} onChange={e => setFilter("type", e.target.value)}><option value="">All room types</option>{roomOptions(rooms, "type_name").map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Floor or corridor<select value={filters.section} onChange={e => setFilter("section", e.target.value)}><option value="">Any location</option>{roomOptions(rooms, "section").map(section => <option key={section}>{section}</option>)}</select></label>
        <label>Bed arrangement<select value={filters.bed} onChange={e => setFilter("bed", e.target.value)}><option value="">Any bed setup</option><option value="single">Includes single beds</option><option value="double">Includes a double bed</option><option value="king">Includes a king bed</option></select></label>
        <label>Listed feature<select value={filters.feature} onChange={e => setFilter("feature", e.target.value)}><option value="">Any feature</option>{roomOptions(rooms, "feature_labels").map(feature => <option key={feature}>{feature}</option>)}</select></label>
      </div>
      <div className="room-filter-checks">
        <label className="check"><input type="checkbox" checked={filters.accessible} onChange={e => setFilter("accessible", e.target.checked)} /> Listed as accessible</label>
        <label className="check"><input type="checkbox" checked={filters.fitsParty} onChange={e => setFilter("fitsParty", e.target.checked)} /> Fits my whole party in one room</label>
        {activeFilters > 0 && <button className="text-button" type="button" onClick={reset}>Clear filters</button>}
      </div>
      {filters.accessible && <p className="hint">An accessibility flag does not confirm suitability for your needs. Please ask the house about the route, bathroom and any specific requirements.</p>}
    </details>

    <div className="room-results-toolbar">
      <p role="status"><strong>{matches.length}</strong> matching {matches.length === 1 ? "room" : "rooms"}<span> of {rooms.length} available for these dates</span></p>
      <label>Sort rooms<select value={sort} onChange={e => { setSort(e.target.value as RoomSort); setLimit(PAGE_SIZE); }}><option value="room">Room number</option><option value="capacity-asc">Capacity: smaller first</option><option value="capacity-desc">Capacity: larger first</option></select></label>
    </div>
    {compare.length > 0 && <div className="room-compare-toolbar">
      <span>{compare.length} of 3 rooms selected for comparison</span>
      <button className="btn sec" type="button" aria-expanded={showCompare} aria-controls="room-comparison" onClick={() => setShowCompare(!showCompare)}>{showCompare ? "Hide comparison" : `Compare rooms (${compare.length})`}</button>
      <button className="text-button" type="button" onClick={() => { setCompare([]); setShowCompare(false); }}>Clear comparison</button>
    </div>}
    {showCompare && compared.length > 0 && <div className="room-comparison" id="room-comparison" tabIndex={0} role="region" aria-label="Room comparison; scroll horizontally on small screens">
      <table><caption>Compare the details that matter to you</caption><thead><tr><th scope="col">Room details</th>{compared.map(room => <th key={room.number} scope="col">Room {room.number}</th>)}</tr></thead>
        <tbody>{([
          ["Room type", (r: AvailableRoom) => r.type_name], ["Location", (r: AvailableRoom) => r.section || "Not listed"],
          ["Capacity", (r: AvailableRoom) => `Up to ${r.sleeps} guests`], ["Beds", (r: AvailableRoom) => r.beds || "Not listed"],
          ["Features", (r: AvailableRoom) => r.feature_labels.join(" · ") || "Not listed"],
          ["Accessibility", (r: AvailableRoom) => r.accessible ? "Flagged accessible; confirm suitability" : "Not flagged; ask the house"],
        ] as [string, (room: AvailableRoom) => string][]).map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{compared.map(room => <td key={room.number}>{value(room)}</td>)}</tr>)}
          <tr><th scope="row">Price & terms</th>{compared.map(room => <td key={room.number}>House to confirm before payment</td>)}</tr>
          <tr><th scope="row">Your request</th>{compared.map(room => <td key={room.number}><button className="btn sec" type="button" aria-pressed={requested.includes(room.number)} onClick={() => toggleRoom(room.number)}>{requested.includes(room.number) ? "Remove" : "Request"} room {room.number}</button></td>)}</tr>
        </tbody>
      </table>
    </div>}
    {matches.length === 0 && <div className="room-empty" role="status"><h4>{rooms.length ? "Let's widen the search." : "No rooms available for these dates."}</h4><p>{rooms.length ? "No rooms match all your filters. You can combine several rooms for a larger party; keep your full guest count." : "Try another arrival or departure date using the search above."}</p>{activeFilters > 0 && <button className="btn sec" type="button" onClick={reset}>Show all available rooms</button>}</div>}
    <div className="room-card-grid">
      {matches.slice(0, limit).map(room => {
        const chosen = requested.includes(room.number);
        return <article className={"room-option-card" + (chosen ? " is-requested" : "")} key={room.number} aria-label={`Room ${room.number}: ${room.type_name}`}>
          <div className="room-option-top"><div><span className="room-eyebrow">Room</span><span className="room-number">{room.number}</span></div><div className="room-location">{room.section || "Location to confirm"}<span>{chosen ? "On your request list" : "Available at this search"}</span></div></div>
          <div className="room-option-body">
            <h4>{room.type_name}</h4>
            <dl className="room-key-details"><div><dt>Capacity</dt><dd>Up to {room.sleeps} {room.sleeps === 1 ? "guest" : "guests"}</dd></div><div><dt>Bed arrangement</dt><dd>{room.beds || "Please ask the house"}</dd></div></dl>
            <ul className="room-feature-list" aria-label="Listed room features">{room.feature_labels.slice(0, 3).map(feature => <li key={feature}>{feature}</li>)}{room.feature_labels.length > 3 && <li>+{room.feature_labels.length - 3} more</li>}</ul>
            <details className="room-full-details"><summary>View full room details</summary><dl><dt>Listed amenities & outlook</dt><dd>{room.feature_labels.join(" · ") || "No additional amenities are listed. Ask the house about anything essential to your stay."}</dd><dt>Accessibility</dt><dd>{room.accessible ? "Listed as accessible. Please describe your requirements so the house can confirm suitability." : "This room is not flagged as accessible. Ask the house if you need step-free access or an adapted bathroom."}</dd><dt>Photos & floor plan</dt><dd>Room-specific photos, measurements and a verified floor plan have not been supplied here. Ask the house before relying on a particular layout.</dd><dt>Price & inclusions</dt><dd>The house will confirm the price, inclusions and terms. Features not listed above are not guaranteed.</dd></dl></details>
            <div className="room-option-actions"><button className={"btn" + (chosen ? " sec" : "")} type="button" aria-pressed={chosen} onClick={() => toggleRoom(room.number)}>{chosen ? "Remove room" : "Request room"} {room.number}<span aria-hidden="true">{chosen ? "−" : "+"}</span></button>
              <label className="check"><input type="checkbox" checked={compare.includes(room.number)} disabled={!compare.includes(room.number) && compare.length >= 3} onChange={() => setCompare(current => toggleComparison(current, room.number))} /> Compare room {room.number}</label>
            </div>
          </div>
        </article>;
      })}
    </div>
    {matches.length > limit && <button className="btn sec room-load-more" type="button" onClick={() => setLimit(n => n + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, matches.length - limit)} more rooms ({matches.length - limit} remaining)</button>}

    <div className="room-request-summary" aria-label="Your room request">
      <div><p className="section-kicker">Your room request</p><h4>{selection.chosen.length ? `${selection.chosen.length} ${selection.chosen.length === 1 ? "room" : "rooms"} for ${guests} ${guests === 1 ? "guest" : "guests"}` : "Choose the rooms that suit you."}</h4>
        <p role="status">{selection.chosen.length ? `Capacity for up to ${selection.capacity} guests.${selection.remaining ? ` Add room capacity for ${selection.remaining} more ${selection.remaining === 1 ? "guest" : "guests"} to continue.` : " Your party fits within the listed capacity."}` : "Add one room or combine several. You can remove a room at any time."}</p>
        {selection.chosen.length > 0 && <ul className="requested-room-chips">{selection.chosen.map(room => <li key={room.number}><span>Room {room.number}</span><button type="button" aria-label={`Remove room ${room.number} from request`} onClick={() => toggleRoom(room.number)}>×</button></li>)}</ul>}
      </div>
      <div><button className="btn" type="button" disabled={!selection.canContinue} onClick={onContinue}>Continue to guest details <span aria-hidden="true">→</span></button><p className="hint">A request only. No payment or room hold.</p></div>
    </div>
  </section>;
}
