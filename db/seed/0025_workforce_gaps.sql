-- House rules the workforce settings screen reads. Annual leave is 28 days. Hourly accrual is 12.07%.

INSERT INTO wf_leave_policy (property_id, code, name, method, days, accrual_percent)
SELECT p.id, 'ANNUAL', 'Annual leave', 'fixed', 28, 0 FROM property p
WHERE NOT EXISTS (SELECT 1 FROM wf_leave_policy x WHERE x.property_id = p.id AND x.code = 'ANNUAL');

INSERT INTO wf_leave_policy (property_id, code, name, method, days, accrual_percent)
SELECT p.id, 'HOURLY', 'Hourly accrual', 'hourly', 0, 12.07 FROM property p
WHERE NOT EXISTS (SELECT 1 FROM wf_leave_policy x WHERE x.property_id = p.id AND x.code = 'HOURLY');

INSERT INTO wf_contract_rule (property_id)
SELECT p.id FROM property p
WHERE NOT EXISTS (SELECT 1 FROM wf_contract_rule r WHERE r.property_id = p.id);

INSERT INTO wf_overtime_rule (property_id)
SELECT p.id FROM property p
WHERE NOT EXISTS (SELECT 1 FROM wf_overtime_rule r WHERE r.property_id = p.id);

UPDATE leave_account
SET accrued = allowance_days,
    valid_from = make_date(year, 9, 1),
    valid_until = make_date(year + 1, 8, 31)
WHERE kind = 'annual' AND accrued = 0 AND valid_from IS NULL;
