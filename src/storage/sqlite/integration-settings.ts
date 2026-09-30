import { connectionsSchema } from '../../../vendor/integration-protocol/index.mjs';
import type { z } from 'zod';
import type { Db } from './open.js';

type Connections = z.infer<typeof connectionsSchema>;
/** Only the strict public connection schema can cross the durable boundary. */
export function createIntegrationSettingsStore(db: Db) {
  return {
    read(): Connections | undefined {
      const row = db.prepare('SELECT connections FROM integration_settings WHERE id = 1').get() as {connections: string} | undefined;
      return row ? connectionsSchema.parse(JSON.parse(row.connections) as unknown) : undefined;
    },
    write(connections: Connections) {
      const value = connectionsSchema.parse(connections);
      db.prepare('INSERT INTO integration_settings(id, connections) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET connections = excluded.connections')
        .run(JSON.stringify(value));
    },
  };
}
