const API_URL = "https://en.wikipedia.org/w/api.php";
const MIN_INTRO_WORDS = 25;
const MAX_ATTEMPTS = 8;

export interface WikiArticle {
  title: string;
  introText: string;
}

interface QueryResponse {
  query?: {
    pages?: Array<{
      title: string;
      extract?: string;
    }>;
  };
}

function isUsableArticle(title: string, extract: string | undefined): extract is string {
  if (!extract) return false;
  if (title.toLowerCase().startsWith("list of")) return false;
  if (/\bmay (also )?refer to\b/i.test(extract)) return false;

  const wordCount = extract.trim().split(/\s+/).length;
  return wordCount >= MIN_INTRO_WORDS;
}

async function fetchOneRandomArticle(): Promise<WikiArticle | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "random",
    grnnamespace: "0",
    grnlimit: "1",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
  });

  const res = await fetch(`${API_URL}?${params.toString()}`, {
    headers: { "User-Agent": "pedantle-bootleg/0.1 (personal side project)" },
  });
  if (!res.ok) {
    throw new Error(`Wikipedia API request failed: ${res.status}`);
  }

  const data = (await res.json()) as QueryResponse;
  const page = data.query?.pages?.[0];
  if (!page || !isUsableArticle(page.title, page.extract)) {
    return null;
  }

  return { title: page.title, introText: page.extract!.trim() };
}

export async function fetchRandomArticle(): Promise<WikiArticle> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const article = await fetchOneRandomArticle();
    if (article) return article;
  }
  throw new Error("Could not find a usable Wikipedia article after several attempts");
}
