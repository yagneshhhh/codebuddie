// Server-only helper: Lovable AI Gateway embeddings.
const MODEL = "google/gemini-embedding-001";
const ENDPOINT = "https://ai.gateway.lovable.dev/v1/embeddings";

async function callEmbeddings(inputs: string[]): Promise<number[][]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: MODEL, input: inputs.length === 1 ? inputs[0] : inputs }),
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await callEmbeddings([text.slice(0, 8000)]);
  return v;
}

// Gemini caps batches at 100; chunk safely.
export async function embedMany(texts: string[]): Promise<number[][]> {
  const trimmed = texts.map((t) => t.slice(0, 8000));
  const out: number[][] = [];
  for (let i = 0; i < trimmed.length; i += 50) {
    const batch = trimmed.slice(i, i + 50);
    const vecs = await callEmbeddings(batch);
    out.push(...vecs);
  }
  return out;
}

// pgvector literal format: "[0.1,0.2,...]"
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
