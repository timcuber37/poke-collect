import psycopg2
import ollama
from sentence_transformers import SentenceTransformer
import config

_model = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def embed(text: str) -> list[float]:
    return get_model().encode(text).tolist()


def retrieve_context(question: str, top_k: int = 5) -> list[str]:
    query_vector = embed(question)
    conn = psycopg2.connect(config.POSTGRES_DSN)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT content
            FROM   card_embeddings
            ORDER  BY embedding <-> %s::vector
            LIMIT  %s
            """,
            (query_vector, top_k),
        )
        rows = cur.fetchall()
    conn.close()
    return [row[0] for row in rows]


def answer_question(question: str) -> str:
    context_chunks = retrieve_context(question)

    if not context_chunks:
        context_text = "No card data is available yet. Add some cards to your collection first."
    else:
        context_text = "\n".join(f"- {c}" for c in context_chunks)

    prompt = f"""You are a helpful assistant for a Pokemon Trading Card collection app.
Use the following card data from the user's collection to answer the question.
Only use the provided context — do not make up card details.

Context:
{context_text}

Question: {question}

Answer:"""

    response = ollama.chat(
        model=config.OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response["message"]["content"]
