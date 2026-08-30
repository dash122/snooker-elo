-- 場次同空檔合而為一。
--
-- availability_slots 本來就有 start_at / end_at / cancelled_at，即係啱嘅形狀一直都喺度。
-- 20260830000000 喺佢隔籬另起咗 nights + night_attendance —— 一日一行、冇時間、而且
-- UNIQUE(night_date) 令全個產品一日得一個場次。呢個 migration 撤回嗰個決定，改為
-- 喺原本嗰張表加兩個欄位。
--
-- 之後「場次」唔再係一張表，而係一個查詢：某場地、某日、未取消嘅 slot，按時間睇重疊。
-- 一日有幾多場，由數據自己講。

-- --------------------------------------------------------------------------
-- 1. 場地
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venues (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  district text NOT NULL DEFAULT '',
  -- 各球種檯數，例如 {"snooker":6}. 而家淨係士碌架，但個形狀已經容得落其他球種。
  tables jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 開得成張表就一定要有一間場，否則下面 venue_id NOT NULL 加唔到。
INSERT INTO public.venues (id, name, district, tables)
VALUES ('venue-scaa', 'SCAA', '灣仔', '{"snooker":6}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. 撤回 nights / night_attendance
-- --------------------------------------------------------------------------
DROP TABLE IF EXISTS public.night_attendance;
DROP TABLE IF EXISTS public.nights;

-- --------------------------------------------------------------------------
-- 3. 清走舊 slot，再拆走開局卡機制
--
-- 舊 slot 冇場地，而 commitment 嘅語意同佢哋當初寫入嗰陣唔同 —— 留住佢哋會令第一日
-- 嘅重疊數字建立喺一批意思已經改變咗嘅資料上面。所以刪，唔係遷移。
-- slot_hands 有 FK 指住 availability_slots，要先落。
-- --------------------------------------------------------------------------
DROP TABLE IF EXISTS public.slot_hands;
DROP TABLE IF EXISTS public.slot_watchers;

DELETE FROM public.availability_slots;

ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS posted;
ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS fill_rule;
ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS filled_by;
ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS filled_at;
ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS result;
ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS closed_at;
-- 舊 venue 係自由文字，而家由 venue_id 取代。
ALTER TABLE public.availability_slots DROP COLUMN IF EXISTS venue;

-- --------------------------------------------------------------------------
-- 4. 一張表講一件事：我幾時會喺邊間波房
-- --------------------------------------------------------------------------
ALTER TABLE public.availability_slots
  ADD COLUMN IF NOT EXISTS venue_id text REFERENCES public.venues(id) ON DELETE RESTRICT;
ALTER TABLE public.availability_slots
  ADD COLUMN IF NOT EXISTS commitment text NOT NULL DEFAULT 'going';

-- 上面已經清空，所以可以直接收緊。
UPDATE public.availability_slots SET venue_id = 'venue-scaa' WHERE venue_id IS NULL;
ALTER TABLE public.availability_slots ALTER COLUMN venue_id SET NOT NULL;

ALTER TABLE public.availability_slots DROP CONSTRAINT IF EXISTS availability_slots_commitment_check;
ALTER TABLE public.availability_slots
  ADD CONSTRAINT availability_slots_commitment_check CHECK (commitment IN ('going','interested'));

-- 一個人喺同一個場地同一段時間唔應該有兩行。重疊由應用層合併。
CREATE INDEX IF NOT EXISTS availability_slots_venue_window_idx
  ON public.availability_slots (venue_id, start_at, end_at) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS availability_slots_player_venue_idx
  ON public.availability_slots (player_id, venue_id, start_at) WHERE cancelled_at IS NULL;

-- --------------------------------------------------------------------------
-- 5. Data API 邊界
--
-- 20260826000000 用一次過嘅 DO loop 開 RLS，唔係 event trigger，所以新表乜都冇。
-- --------------------------------------------------------------------------
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api_clients" ON public.venues;
CREATE POLICY "deny_data_api_clients" ON public.venues
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.venues FROM PUBLIC, anon, authenticated;
