/** Work only with the public availability response, never the staff room board. */
export type AvailableRoom = {
  number: string; section: string | null; type_name: string; sleeps: number;
  beds: string; feature_labels: string[]; accessible: boolean;
};
export type RoomFilters = { type: string; section: string; bed: string; feature: string; accessible: boolean; fitsParty: boolean };
export const EMPTY_ROOM_FILTERS: RoomFilters = { type: "", section: "", bed: "", feature: "", accessible: false, fitsParty: false };
export type RoomSort = "room" | "capacity-asc" | "capacity-desc";

export function filterRooms(rooms: AvailableRoom[], filters: RoomFilters, guests: number, sort: RoomSort = "room"): AvailableRoom[] {
  const result = rooms.filter(room =>
    (!filters.type || room.type_name === filters.type) &&
    (!filters.section || room.section === filters.section) &&
    (!filters.bed || room.beds.toLowerCase().includes(filters.bed)) &&
    (!filters.feature || room.feature_labels.includes(filters.feature)) &&
    (!filters.accessible || room.accessible) &&
    (!filters.fitsParty || room.sleeps >= guests)
  );
  return result.sort((a, b) => {
    const capacity = sort === "capacity-asc" ? a.sleeps - b.sleeps : sort === "capacity-desc" ? b.sleeps - a.sleeps : 0;
    return capacity || a.number.localeCompare(b.number, "en-GB", { numeric: true });
  });
}

export function roomSelection(rooms: AvailableRoom[], requested: string[], guests: number) {
  const numbers = new Set(requested);
  const chosen = rooms.filter(room => numbers.has(room.number));
  const capacity = chosen.reduce((sum, room) => sum + Math.max(0, Number(room.sleeps) || 0), 0);
  return { chosen, capacity, remaining: Math.max(0, guests - capacity), canContinue: chosen.length > 0 && Number.isInteger(guests) && guests > 0 && capacity >= guests };
}

/** A preference, not an allocation or inventory hold. Keep the existing enquiry contract. */
export function roomRequestText(rooms: AvailableRoom[]): string {
  if (!rooms.length) return "";
  return "Requested rooms (subject to house confirmation): " + rooms.map(r => `${r.number} — ${r.type_name}`).join("; ");
}

export function roomOptions(rooms: AvailableRoom[], field: "type_name" | "section" | "feature_labels"): string[] {
  return [...new Set(rooms.flatMap(room => {
    const value = room[field];
    return Array.isArray(value) ? value : value ? [value] : [];
  }))].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true }));
}

export function toggleComparison(current: string[], number: string): string[] {
  if (current.includes(number)) return current.filter(n => n !== number);
  return current.length < 3 ? [...current, number] : current;
}
