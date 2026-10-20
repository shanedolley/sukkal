/**
 * Chunks the sources and embeds whatever needs it, once.
 *
 *     npm run embed
 *
 * It acts on the database `DATABASE_URL` names and says which before it
 * starts. The Voyage key is read from that database's `voyage` connection, so
 * point it at a database that holds one. The worker does this as sources arrive
 * (`src/worker/embed.ts`, KPA-114), and the two may run together: the embedder
 * writes a vector only for the text it embedded.
 */
import { connect } from '../src/db/connect.ts';
import { chunkSources, embedPending } from '../src/embed/embedder.ts';
import { voyageFromConnection } from '../src/embed/voyage.ts';

const client = connect();
await client.connect();
try {
  const name = await client.query<{ name: string }>('SELECT current_database() AS name');
  console.log(`database: ${name.rows[0]?.name}`);

  const chunked = await chunkSources(client);
  console.log(`chunked ${chunked.sources} sources into ${chunked.chunks} chunks`);
  for (const failure of chunked.failures) {
    console.error(`source ${failure.sourceId} not chunked: ${failure.reason}`);
  }

  const done = await embedPending(client, await voyageFromConnection(client));
  console.log(
    `embedded ${done.embedded}, failed ${done.failed}, skipped ${done.skipped}, superseded ${done.superseded}`,
  );
  for (const line of done.errors) console.error(line);
  process.exitCode = done.failed > 0 || done.halted !== null || chunked.failures.length > 0 ? 1 : 0;
} finally {
  await client.end();
}
