-- A person can work on more than one department rota. Hours still add up to one week.
CREATE TABLE IF NOT EXISTS staff_department (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id),
  department text NOT NULL,
  PRIMARY KEY (user_id, property_id, department)
);

INSERT INTO staff_department (user_id, property_id, department)
SELECT DISTINCT m.user_id, m.property_id, d.code
FROM membership m
JOIN department d ON d.id = m.department_id
ON CONFLICT DO NOTHING;
