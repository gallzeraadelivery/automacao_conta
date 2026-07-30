import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index";

let pool: Pool | undefined;
let instance: NodePgDatabase<typeof schema> | undefined;

function getDb(): NodePgDatabase<typeof schema> {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
    // node-postgres emite 'error' no Pool quando um cliente ocioso perde a
    // conexao (ex: Postgres reiniciou) - sem um listener, isso e um evento
    // 'error' sem handler, que o Node trata como excecao nao capturada e
    // derruba o processo inteiro. Uma query em andamento ja rejeita sua
    // propria Promise (tratada normalmente pelo chamador) - isto e so para
    // erros de conexao ociosa em segundo plano, que nao tem chamador algum.
    pool.on("error", (error) => {
      console.error("Erro inesperado no pool de conexoes do Postgres:", error);
    });
    instance = drizzle(pool, { schema });
  }
  return instance;
}

/**
 * A conexao so e criada no primeiro uso real (nao no import), para nao
 * depender da ordem em que o `.env` e carregado pelo pacote consumidor.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type Database = typeof db;

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    instance = undefined;
  }
}
