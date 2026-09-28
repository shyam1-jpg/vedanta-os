-- Give every existing SOP a stable slug and a department so the library can group them.

UPDATE staff_sop
SET slug = trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL OR slug = '';

UPDATE staff_sop SET department = 'KITCHEN' WHERE department IS NULL AND title ILIKE 'kitchen%';
UPDATE staff_sop SET department = 'HK' WHERE department IS NULL AND title ILIKE 'housekeeping%';
UPDATE staff_sop SET department = 'FRONT' WHERE department IS NULL AND (title ILIKE 'reception%' OR title ILIKE '%night porter%');
UPDATE staff_sop SET department = 'MAINT' WHERE department IS NULL AND title ILIKE 'maintenance%';
UPDATE staff_sop SET department = 'HOUSE' WHERE department IS NULL;
