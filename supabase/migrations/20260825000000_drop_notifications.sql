-- The 約戰 通知設定 tab (per-channel prefs, quiet hours) and the browser push-notification
-- opt-in that sat behind it were both removed from the app: notifications now go by email only,
-- always, with no member-configurable preferences. Drop the tables that backed them.

DROP TABLE IF EXISTS public.notification_prefs;
DROP TABLE IF EXISTS public.push_subscriptions;
