ALTER TABLE members ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE members SET username = lower(split_part(email, '@', 1)) WHERE username IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_username_idx ON members (username);
