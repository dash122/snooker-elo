ALTER TABLE members ADD COLUMN IF NOT EXISTS icon_colour text;

UPDATE members m
SET initials = COALESCE(m.initials, p.short),
    icon_colour = COALESCE(m.icon_colour, p.colour)
FROM state_players p
WHERE p.id = m.state_player_id;

UPDATE state_players p
SET short = m.initials,
    colour = m.icon_colour
FROM members m
WHERE m.state_player_id = p.id
  AND m.initials IS NOT NULL;
