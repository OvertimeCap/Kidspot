-- Remove foreign key constraint on sponsorship_contracts.place_id
-- so contracts can reference any Google Places ID, not just ones already in the DB
ALTER TABLE sponsorship_contracts
  DROP CONSTRAINT IF EXISTS sponsorship_contracts_place_id_fkey;
