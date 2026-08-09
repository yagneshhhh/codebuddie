CREATE TABLE public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  repo_id uuid NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES public.analyses(id) ON DELETE SET NULL,
  trigger text NOT NULL DEFAULT 'manual',
  ref text,
  commit_sha text,
  commit_message text,
  agents text[],
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analysis_jobs_pending_idx ON public.analysis_jobs (status, run_at);
CREATE INDEX analysis_jobs_user_idx ON public.analysis_jobs (user_id, created_at DESC);

GRANT SELECT ON public.analysis_jobs TO authenticated;
GRANT ALL ON public.analysis_jobs TO service_role;

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own analysis jobs"
  ON public.analysis_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_analysis_jobs(p_limit int DEFAULT 1)
RETURNS SETOF public.analysis_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id FROM public.analysis_jobs j
    WHERE (j.status = 'queued' AND j.run_at <= now())
       OR (j.status = 'running' AND j.locked_at < now() - interval '15 minutes')
    ORDER BY j.run_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.analysis_jobs j
  SET status = 'running',
      locked_at = now(),
      attempts = j.attempts + 1,
      updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_analysis_jobs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_jobs(int) TO service_role;