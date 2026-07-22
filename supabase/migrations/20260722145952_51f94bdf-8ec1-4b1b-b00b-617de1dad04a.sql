
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
-- Explicit deny-all policy so github_tokens is unreachable except via service_role
CREATE POLICY "no user access" ON public.github_tokens FOR ALL USING (false) WITH CHECK (false);
