ALTER TABLE app_state_snapshots ALTER COLUMN state DROP NOT NULL;

CREATE TABLE IF NOT EXISTS app_state_snapshot_entities (
  content_hash text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state_snapshot_items (
  snapshot_id bigint NOT NULL REFERENCES app_state_snapshots(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  content_hash text NOT NULL REFERENCES app_state_snapshot_entities(content_hash),
  position integer NOT NULL,
  PRIMARY KEY (snapshot_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS app_state_snapshot_items_lookup_idx
  ON app_state_snapshot_items (snapshot_id, entity_type, position);

INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
SELECT md5('settings' || chr(0) || 'settings' || chr(0) || (s.state->'settings')::text), 'settings', 'settings', s.state->'settings'
FROM app_state_snapshots s
WHERE s.state IS NOT NULL AND s.state ? 'settings'
ON CONFLICT (content_hash) DO NOTHING;

INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
SELECT md5('player' || chr(0) || (item->>'id') || chr(0) || item::text), 'player', item->>'id', item
FROM app_state_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'players', '[]'::jsonb)) AS rows(item)
WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
ON CONFLICT (content_hash) DO NOTHING;

INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
SELECT md5('match' || chr(0) || (item->>'id') || chr(0) || item::text), 'match', item->>'id', item
FROM app_state_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'matches', '[]'::jsonb)) AS rows(item)
WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
ON CONFLICT (content_hash) DO NOTHING;

INSERT INTO app_state_snapshot_entities (content_hash, entity_type, entity_id, payload)
SELECT md5('audit' || chr(0) || (item->>'id') || chr(0) || item::text), 'audit', item->>'id', item
FROM app_state_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'audits', '[]'::jsonb)) AS rows(item)
WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
ON CONFLICT (content_hash) DO NOTHING;

INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
SELECT s.id, 'settings', 'settings', md5('settings' || chr(0) || 'settings' || chr(0) || (s.state->'settings')::text), 0
FROM app_state_snapshots s
WHERE s.state IS NOT NULL AND s.state ? 'settings'
ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING;

INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
SELECT s.id, 'player', item->>'id', md5('player' || chr(0) || (item->>'id') || chr(0) || item::text), rows.ordinality::integer - 1
FROM app_state_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'players', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING;

INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
SELECT s.id, 'match', item->>'id', md5('match' || chr(0) || (item->>'id') || chr(0) || item::text), rows.ordinality::integer - 1
FROM app_state_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'matches', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING;

INSERT INTO app_state_snapshot_items (snapshot_id, entity_type, entity_id, content_hash, position)
SELECT s.id, 'audit', item->>'id', md5('audit' || chr(0) || (item->>'id') || chr(0) || item::text), rows.ordinality::integer - 1
FROM app_state_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'audits', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ordinality)
WHERE s.state IS NOT NULL AND item->>'id' IS NOT NULL
ON CONFLICT (snapshot_id, entity_type, entity_id) DO NOTHING;

UPDATE app_state_snapshots SET state = NULL WHERE state IS NOT NULL;