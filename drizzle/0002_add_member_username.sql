ALTER TABLE members ADD COLUMN username TEXT;
UPDATE members SET username = lower(substr(email, 1, instr(email, '@') - 1)) WHERE username IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_username_idx ON members (username);
