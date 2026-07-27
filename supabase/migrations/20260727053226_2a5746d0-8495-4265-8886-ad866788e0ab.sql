CREATE TABLE public.job_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  agent text,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'info',
  message text,
  duration_ms integer,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.job_events TO authenticated;
GRANT ALL ON public.job_events TO service_role;

ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own job events read" ON public.job_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX job_events_analysis_idx ON public.job_events (analysis_id, created_at);

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS agent_status jsonb;