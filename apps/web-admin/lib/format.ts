export const fmt = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", opts);
export const nights = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / 86400000);
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return Number.isNaN(+dt) ? iso : dt.toISOString().slice(0, 10);
};
