-- Staff personal and bank details. The API stores these as ciphertext only.
-- There is no seed data here.
ALTER TABLE staff_hr
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_sort_code text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS national_insurance text,
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS date_of_birth text;
