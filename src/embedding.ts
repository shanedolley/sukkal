/**
 * The embedding model, and the width every vector column declares.
 *
 * A pgvector column needs a fixed width, so the model is chosen here rather
 * than in the embedder. **Changing either value is a migration**, not a
 * configuration change: the existing vectors are the wrong width and the wrong
 * model's output, so they have to be rebuilt.
 *
 * `voyage-4` over `voyage-4-large`: the corpus is 17 facts and 32 sources, and
 * the larger model costs more for quality that corpus cannot show. Both take
 * 1024 by default, so moving up later changes the model name and not the
 * schema. Checked against Voyage's model list on 27 August 2026, where
 * `voyage-3` is a legacy model.
 */
export const EMBEDDING = {
  model: 'voyage-4',
  /** Voyage's default. It also offers 256, 512 and 2048. */
  dimension: 1024,
} as const;
