ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS webhook_secret text,
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_event_at timestamp with time zone;

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS commit_sha text,
  ADD COLUMN IF NOT EXISTS commit_message text;

CREATE INDEX IF NOT EXISTS repos_full_name_idx ON public.repos (github_full_name);