import {directoryConnectionsSchema} from '../../../vendor/integration-protocol/directory.mjs';
import type {z} from 'zod';
import type {Db} from './open.js';
type Directories=z.infer<typeof directoryConnectionsSchema>;
export function createIntegrationDirectoryStore(db:Db){
  return {
    read():Directories{
      const row=db.prepare('SELECT directories FROM integration_directories WHERE id = 1').get() as {directories:string}|undefined;
      return row?directoryConnectionsSchema.parse(JSON.parse(row.directories) as unknown):[];
    },
    write(directories:Directories){
      const parsed=directoryConnectionsSchema.parse(directories);
      db.prepare('INSERT INTO integration_directories(id, directories) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET directories=excluded.directories').run(JSON.stringify(parsed));
    },
  };
}
