DELETE FROM app_state_snapshots WHERE id NOT IN (SELECT id FROM app_state_snapshots ORDER BY saved_at DESC LIMIT 100);
