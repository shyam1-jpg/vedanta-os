"use client";

export type AllergenTick = { code: string; severity: string; adrenaline_pen?: boolean };
export type DietPerson = {
  given_name: string;
  family_name: string;
  diet: string[];
  allergens: AllergenTick[];
  other: string;
  allergen_other: string;
  accessibility: string;
  plate: string;
};

export const DIETS: [string, string][] = [
  ["vegetarian", "Vegetarian"],
  ["vegan", "Vegan"],
  ["gluten_free", "Gluten-free"],
  ["dairy_free", "Dairy-free"],
  ["nut_free", "No nuts"],
  ["jain", "Jain"],
  ["sattvic", "Sattvic"],
  ["halal", "Halal"],
  ["kosher", "Kosher"],
  ["low_fodmap", "Low-FODMAP"],
  ["diabetic_friendly", "Diabetic-friendly"],
];
export const ALLERGENS: [string, string][] = [
  ["celery", "Celery"],
  ["cereals_gluten", "Cereals containing gluten"],
  ["crustaceans", "Crustaceans"],
  ["eggs", "Eggs"],
  ["fish", "Fish"],
  ["lupin", "Lupin"],
  ["milk", "Milk"],
  ["molluscs", "Molluscs"],
  ["mustard", "Mustard"],
  ["nuts", "Tree nuts"],
  ["peanuts", "Peanuts"],
  ["sesame", "Sesame"],
  ["soya", "Soya"],
  ["sulphites", "Sulphites"],
  ["other", "Other allergen"],
];
export const SEVERITIES: [string, string][] = [
  ["INTOLERANCE", "Intolerance"],
  ["ALLERGY", "Allergy"],
  ["ANAPHYLAXIS", "Severe or anaphylaxis"],
];
export const ACCESS: [string, string][] = [
  ["step_free", "Step-free access"],
  ["ground_floor", "Ground-floor room"],
  ["walk_in_shower", "Walk-in shower"],
  ["grab_rails", "Grab rails"],
  ["quiet_room", "Quiet room"],
  ["assistance_dog", "Assistance dog"],
  ["hearing_loop", "Hearing loop / visual alerts"],
  ["mobility_aid", "Mobility aid storage"],
  ["luggage_help", "Help with luggage"],
];

function toggle(list: string[], code: string): string[] {
  return list.includes(code) ? list.filter(item => item !== code) : [...list, code];
}

export default function DietAccess({
  people, onPerson, access, onAccess, accessNote, onAccessNote, keep, onKeep,
}: {
  people: DietPerson[];
  onPerson: (index: number, next: DietPerson) => void;
  access: string[];
  onAccess: (next: string[]) => void;
  accessNote: string;
  onAccessNote: (next: string) => void;
  keep: boolean;
  onKeep: (next: boolean) => void;
}) {
  return (
    <div data-testid="diet-access">
      <p id="kitchen-note" className="hint">The kitchen is pure vegetarian, with no eggs and no onion family (onion, garlic, shallot, leek or chive). Tick an allergen only when it applies. Every UK allergen is still captured, including ones this kitchen does not use.</p>
      {people.map((person, i) => (
        <div className="diet-p" key={i} data-testid={`person-${i}`}>
          <b>Person {i + 1}</b>
          <label htmlFor={`given-${i}`}>First name</label>
          <input id={`given-${i}`} autoComplete="given-name" value={person.given_name} onChange={e => onPerson(i, { ...person, given_name: e.target.value })} />
          <label htmlFor={`family-${i}`}>Last name</label>
          <input id={`family-${i}`} autoComplete="family-name" value={person.family_name} onChange={e => onPerson(i, { ...person, family_name: e.target.value })} />

          <fieldset className="needs">
            <legend id={`diet-legend-${i}`}>Dietary preferences</legend>
            <div className="tap-set" role="group" aria-labelledby={`diet-legend-${i}`} aria-describedby="kitchen-note">
              {DIETS.map(([code, label]) => {
                const on = person.diet.includes(code);
                return (
                  <button type="button" key={code} className={"tap" + (on ? " on" : "")} role="checkbox" aria-checked={on} onClick={() => onPerson(i, { ...person, diet: toggle(person.diet, code) })}>
                    {label}
                  </button>
                );
              })}
            </div>
            <label htmlFor={`diet-other-${i}`}>Other diet (please specify)</label>
            <input id={`diet-other-${i}`} value={person.other} onChange={e => onPerson(i, { ...person, other: e.target.value })} />
            {person.other.trim() && <p className="review">Staff will review this note before your stay.</p>}
          </fieldset>

          <fieldset className="needs">
            <legend id={`allergen-legend-${i}`}>Allergens</legend>
            <div className="tap-set" role="group" aria-labelledby={`allergen-legend-${i}`}>
              {ALLERGENS.map(([code, label]) => {
                const on = person.allergens.some(a => a.code === code);
                return (
                  <button
                    type="button"
                    key={code}
                    className={"tap" + (on ? " on" : "")}
                    role="checkbox"
                    aria-checked={on}
                    aria-controls={on ? `sev-${i}-${code}` : undefined}
                    onClick={() => onPerson(i, {
                      ...person,
                      allergens: on
                        ? person.allergens.filter(a => a.code !== code)
                        : [...person.allergens, { code, severity: "", adrenaline_pen: false }],
                      allergen_other: code === "other" && on ? "" : person.allergen_other,
                    })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {person.allergens.map(tick => {
              const label = ALLERGENS.find(([code]) => code === tick.code)?.[1] ?? tick.code;
              return (
                <div className="allergen-row" key={tick.code} id={`sev-${i}-${tick.code}`}>
                  <div className="lbl" id={`sev-label-${i}-${tick.code}`}>{label}: how serious is it?</div>
                  <div className="tap-set" role="radiogroup" aria-labelledby={`sev-label-${i}-${tick.code}`}>
                    {SEVERITIES.map(([value, text]) => (
                      <button
                        type="button"
                        key={value}
                        className={"tap" + (tick.severity === value ? " on" : "")}
                        role="radio"
                        aria-checked={tick.severity === value}
                        onClick={() => onPerson(i, {
                          ...person,
                          allergens: person.allergens.map(a => a.code === tick.code ? { ...a, severity: value, adrenaline_pen: value === "ANAPHYLAXIS" ? a.adrenaline_pen : false } : a),
                        })}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  {tick.severity === "ANAPHYLAXIS" && (
                    <button
                      type="button"
                      className={"tap" + (tick.adrenaline_pen ? " on" : "")}
                      role="checkbox"
                      aria-checked={!!tick.adrenaline_pen}
                      onClick={() => onPerson(i, {
                        ...person,
                        allergens: person.allergens.map(a => a.code === tick.code ? { ...a, adrenaline_pen: !a.adrenaline_pen } : a),
                      })}
                    >
                      Carries an adrenaline pen
                    </button>
                  )}
                </div>
              );
            })}
            {person.allergens.some(a => a.code === "other") && (
              <>
                <label htmlFor={`allergen-other-${i}`}>Other allergen (please specify)</label>
                <input id={`allergen-other-${i}`} required value={person.allergen_other} onChange={e => onPerson(i, { ...person, allergen_other: e.target.value })} />
                {person.allergen_other.trim() && <p className="review">Staff will review this note before your stay.</p>}
              </>
            )}
          </fieldset>

          <label htmlFor={`plate-${i}`}>Plate</label>
          <select id={`plate-${i}`} value={person.plate} onChange={e => onPerson(i, { ...person, plate: e.target.value })}>
            <option value="buffet">Buffet — I can serve myself</option>
            <option value="prepared">Please prepare a plate</option>
            <option value="table_service">I need table service</option>
          </select>
        </div>
      ))}

      <fieldset className="needs" data-testid="access-choices">
        <legend id="access-legend">Accessibility</legend>
        <div className="tap-set" role="group" aria-labelledby="access-legend">
          {ACCESS.map(([code, label]) => {
            const on = access.includes(code);
            return (
              <button type="button" key={code} className={"tap" + (on ? " on" : "")} role="checkbox" aria-checked={on} onClick={() => onAccess(toggle(access, code))}>
                {label}
              </button>
            );
          })}
        </div>
        <label htmlFor="access-note">Anything else we should know</label>
        <textarea id="access-note" rows={2} value={accessNote} onChange={e => onAccessNote(e.target.value)} />
        {accessNote.trim() && <p className="review">Staff will review this note before your stay.</p>}
      </fieldset>

      <p className="hint">Diet, allergens and access needs are health information. The kitchen and restaurant receive the diet and allergen codes. Housekeeping and reception receive the access codes. A free-text note is flagged for a person to read. These details are removed after the stay unless you ask us to keep them.</p>
      <label className="check">
        <input type="checkbox" checked={keep} onChange={e => onKeep(e.target.checked)} />
        <span>Keep my dietary and allergen details for future stays</span>
      </label>
    </div>
  );
}
