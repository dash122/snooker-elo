-- Accounts created by signing in with Google never choose a password: signup
-- writes a random, never-surfaced one just to satisfy password_hash NOT NULL.
-- Every "confirm with your current password" step (changing username/email,
-- setting a password, disconnecting Google, deactivating) was therefore
-- impossible for those members. password_set records whether the stored hash
-- is one the member actually knows.
ALTER TABLE members ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT true;

-- Backfill the accounts Google created before this column existed. They are
-- identified by the audit row signup writes for them; members who signed up
-- with a password and only linked Google later have no such row, so they keep
-- password_set = true and their password keeps being asked for.
UPDATE members m
SET password_set = false
WHERE m.google_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM state_audits a
    WHERE a.text = 'Google 帳戶登入並建立球員：' || m.display_name
  );
