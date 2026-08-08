-- Explicit owner-scoped write policies for job_events (audit log stays immutable)
CREATE POLICY "own job events insert"
ON public.job_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

REVOKE UPDATE, DELETE ON public.job_events FROM authenticated;
GRANT SELECT, INSERT ON public.job_events TO authenticated;
GRANT ALL ON public.job_events TO service_role;