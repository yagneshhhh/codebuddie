CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.analysis_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  source text NOT NULL,
  content text NOT NULL,
  metadata jsonb,
  embedding vector(3072) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_chunks TO authenticated;
GRANT ALL ON public.analysis_chunks TO service_role;

ALTER TABLE public.analysis_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own chunks" ON public.analysis_chunks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX analysis_chunks_analysis_idx ON public.analysis_chunks(analysis_id);
CREATE INDEX analysis_chunks_embedding_idx
  ON public.analysis_chunks
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.kind, c.source, c.content, c.metadata,
    1 - (c.embedding::halfvec(3072) <=> p_query_embedding::halfvec(3072)) AS similarity
  FROM public.analysis_chunks c
  JOIN public.analyses a ON a.id = c.analysis_id
  WHERE c.analysis_id = p_analysis_id
    AND a.user_id = auth.uid()
  ORDER BY c.embedding::halfvec(3072) <=> p_query_embedding::halfvec(3072)
  LIMIT p_match_count;
$$;

REVOKE ALL ON FUNCTION public.match_analysis_chunks(uuid, vector, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_analysis_chunks(uuid, vector, int) TO authenticated, service_role;