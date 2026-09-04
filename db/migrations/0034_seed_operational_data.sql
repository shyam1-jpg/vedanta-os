-- Migration 0034: Seed real operational data for Vedanta Oway Retreat
-- Suppliers, compliance records, asset register — real data from the property

DO $$
DECLARE
  t uuid; p uuid;
BEGIN
  SELECT id INTO t FROM tenant LIMIT 1;
  SELECT id INTO p FROM property WHERE code='VOR' LIMIT 1;

  IF t IS NULL OR p IS NULL THEN RETURN; END IF;

  -- ── SUPPLIERS ──────────────────────────────────────────────────────────
  INSERT INTO supplier (tenant_id, property_id, name, code, contact_email, payment_terms, notes) VALUES
    (t, p, 'Suma Wholefoods', 'SUMA', 'orders@suma.coop', 30, 'Organic wholefoods cooperative — main food supplier'),
    (t, p, 'Organic Wholesale', 'OWS', NULL, 30, 'Organic produce'),
    (t, p, 'Walkers Nonsuch', 'WALKERS', NULL, 30, 'Beverages and snacks'),
    (t, p, 'Nairn''s Oatcakes', 'NAIRNS', NULL, 30, 'Oatcakes and crackers'),
    (t, p, 'Lincolnshire Cooperative', 'LINCS_CO', NULL, 14, 'Local produce and essentials'),
    (t, p, 'Amazon Business', 'AMAZON', NULL, 30, 'General supplies and office'),
    (t, p, 'Screwfix', 'SCREWFIX', NULL, 0, 'Maintenance and trade supplies'),
    (t, p, 'Jewson', 'JEWSON', NULL, 30, 'Building and maintenance materials'),
    (t, p, 'British Gas Business', 'BRITGAS', 'business@britishgas.co.uk', 30, 'Gas supply'),
    (t, p, 'EON Energy', 'EON', NULL, 30, 'Electricity supply')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- ── COMPLIANCE RECORDS ─────────────────────────────────────────────────
  INSERT INTO compliance_record (tenant_id, property_id, category, title, frequency, due_date) VALUES
    (t, p, 'fire_safety', 'Fire risk assessment review', 'annual', current_date + 90),
    (t, p, 'fire_safety', 'Fire alarm test', 'weekly', current_date + 7),
    (t, p, 'fire_safety', 'Fire extinguisher inspection', 'annual', current_date + 180),
    (t, p, 'fire_safety', 'Emergency lighting test', 'monthly', current_date + 30),
    (t, p, 'fire_safety', 'Fire evacuation drill', 'annual', current_date + 365),
    (t, p, 'food_hygiene', 'Kitchen deep clean', 'quarterly', current_date + 45),
    (t, p, 'food_hygiene', 'Fridge temperature log', 'daily', current_date + 1),
    (t, p, 'food_hygiene', 'HACCP review', 'annual', current_date + 365),
    (t, p, 'food_hygiene', 'Food hygiene certificates renewal check', 'annual', current_date + 90),
    (t, p, 'legionella', 'Legionella risk assessment', 'annual', current_date + 180),
    (t, p, 'legionella', 'Hot water temperature checks', 'monthly', current_date + 30),
    (t, p, 'legionella', 'Cold water tank inspection', 'annual', current_date + 365),
    (t, p, 'health_safety', 'H&S policy review', 'annual', current_date + 365),
    (t, p, 'health_safety', 'Risk assessment update', 'annual', current_date + 90),
    (t, p, 'health_safety', 'First aid kit check', 'monthly', current_date + 30),
    (t, p, 'health_safety', 'Manual handling training', 'annual', current_date + 180),
    (t, p, 'health_safety', 'COSHH register review', 'annual', current_date + 365),
    (t, p, 'licensing', 'Premises licence review', 'annual', current_date + 365),
    (t, p, 'licensing', 'DBS checks renewal', 'annual', current_date + 180),
    (t, p, 'gdpr', 'Data protection audit', 'annual', current_date + 180),
    (t, p, 'gdpr', 'Privacy notice review', 'annual', current_date + 365)
  ON CONFLICT DO NOTHING;

  -- ── ASSET REGISTER ─────────────────────────────────────────────────────
  INSERT INTO asset (tenant_id, property_id, qr_code, name, category, location, next_service_date, status, notes) VALUES
    (t, p, 'VOR-ASSET-00001', 'Commercial Dishwasher', 'kitchen', 'Main kitchen', current_date + 60, 'operational', 'Hobart AM15 — service annually'),
    (t, p, 'VOR-ASSET-00002', 'Commercial Refrigerator (Walk-in)', 'kitchen', 'Main kitchen', current_date + 90, 'operational', 'Temperature log daily'),
    (t, p, 'VOR-ASSET-00003', 'Combi Oven', 'kitchen', 'Main kitchen', current_date + 120, 'operational', 'Rational SCC — service 6-monthly'),
    (t, p, 'VOR-ASSET-00004', 'Industrial Range Cooker', 'kitchen', 'Main kitchen', current_date + 180, 'operational', NULL),
    (t, p, 'VOR-ASSET-00005', 'Fire Suppression System', 'safety', 'Main kitchen', current_date + 30, 'operational', 'Annual inspection mandatory'),
    (t, p, 'VOR-ASSET-00006', 'Boiler (Main House)', 'hvac', 'Boiler room', current_date + 45, 'operational', 'Gas Safety Certificate due — annual'),
    (t, p, 'VOR-ASSET-00007', 'Boiler (Annexe)', 'hvac', 'Annexe boiler room', current_date + 45, 'operational', 'Gas Safety Certificate due — annual'),
    (t, p, 'VOR-ASSET-00008', 'Solar Panel Array', 'hvac', 'Roof', current_date + 365, 'operational', '48kWp — annual inspection'),
    (t, p, 'VOR-ASSET-00009', 'EV Charging Points', 'grounds', 'Car park', current_date + 365, 'operational', '4x 7kW chargers'),
    (t, p, 'VOR-ASSET-00010', 'Riding Mower', 'grounds', 'Grounds shed', current_date + 30, 'operational', 'Service before season — blades, oil, air filter'),
    (t, p, 'VOR-ASSET-00011', 'Minibus (16 seat)', 'vehicle', 'Car park', current_date + 60, 'operational', 'MOT and service — 12-monthly'),
    (t, p, 'VOR-ASSET-00012', 'Defibrillator (AED)', 'safety', 'Reception hallway', current_date + 365, 'operational', 'Pad expiry check — check date on unit'),
    (t, p, 'VOR-ASSET-00013', 'Emergency Generator', 'hvac', 'Plant room', current_date - 30, 'operational', '⚠️ Service OVERDUE — schedule immediately'),
    (t, p, 'VOR-ASSET-00014', 'Commercial Laundry (Washer)', 'appliance', 'Laundry room', current_date + 180, 'operational', NULL),
    (t, p, 'VOR-ASSET-00015', 'Commercial Laundry (Dryer)', 'appliance', 'Laundry room', current_date + 180, 'operational', NULL)
  ON CONFLICT (qr_code) DO NOTHING;

END $$;
