"use client";

const LABEL: Record<string, string> = {
  celery: "Celery", cereals_gluten: "Gluten", crustaceans: "Crustaceans", eggs: "Eggs", fish: "Fish",
  lupin: "Lupin", milk: "Milk", molluscs: "Molluscs", mustard: "Mustard", nuts: "Tree nuts",
  peanuts: "Peanuts", sesame: "Sesame", soya: "Soya", sulphites: "Sulphites",
};

export default function AllergenFields({
  choices, picked, setPicked, severity, setSeverity, notes, setNotes, access, setAccess,
}: {
  choices: string[];
  picked: string[];
  setPicked: (next: string[]) => void;
  severity: string;
  setSeverity: (next: string) => void;
  notes: string;
  setNotes: (next: string) => void;
  access: boolean;
  setAccess: (next: boolean) => void;
}) {
  return (
    <>
      <div className="lbl">Allergies — the 14 UK allergens</div>
      <div className="chips">
        {choices.map(code => (
          <button key={code} type="button" className={"chipbtn" + (picked.includes(code) ? " on warn" : "")} onClick={() => setPicked(picked.includes(code) ? picked.filter(item => item !== code) : [...picked, code])}>
            {LABEL[code] ?? code}
          </button>
        ))}
      </div>
      {picked.length > 0 && (
        <div className="fgrid">
          <label>How serious?
            <select aria-label="Allergy severity" value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="">choose…</option>
              <option value="PREFERENCE">Preference</option>
              <option value="INTOLERANCE">Intolerance / discomfort</option>
              <option value="ALLERGY">Allergy</option>
              <option value="ANAPHYLAXIS">Severe — risk of anaphylaxis</option>
            </select>
          </label>
          <label>Kitchen note<input aria-label="Allergy note" value={notes} onChange={e => setNotes(e.target.value)} /></label>
        </div>
      )}
      <label className="assign-check"><input type="checkbox" checked={access} onChange={e => setAccess(e.target.checked)} /> I need step-free access</label>
    </>
  );
}
