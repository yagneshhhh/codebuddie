CREATE OR REPLACE FUNCTION public.match_analysis_chunks(
  p_analysis_id uuid,
  p_query_embedding vector(3072),
  p_match_count int DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  kind text,
  source text,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.id, c.kind, c.source, c.content, c.metadata,
    1 - (c.embedding::halfvec(3072) <=> p_query_embedding::halfvec(3072)) AS similarity
  FROM public.analysis_chunks c
  WHERE c.analysis_id = p_analysis_id
  ORDER BY c.embedding::halfvec(3072) <=> p_query_embedding::halfvec(3072)
  LIMIT p_match_count;
$$;