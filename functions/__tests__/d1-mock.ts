// D1-compatible adapter backed by better-sqlite3 (SQLite under the hood,
// same as Cloudflare D1). Makes db.ts functions testable without workerd.
import Database from "better-sqlite3";

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta: { changes: number; last_row_id: number | bigint };
}

class D1PreparedStatement {
  private stmt: Database.Statement;
  private bindings: unknown[] = [];

  constructor(stmt: Database.Statement) {
    this.stmt = stmt;
  }

  bind(...values: unknown[]): this {
    this.bindings = values;
    return this;
  }

  async run(): Promise<D1Result> {
    const info = this.stmt.run(...this.bindings);
    return {
      results: [],
      success: true,
      meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.stmt.get(...this.bindings) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.stmt.all(...this.bindings) as T[];
    return { results: rows };
  }
}

export function createD1Mock(sql?: string): D1Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  if (sql) db.exec(sql);

  const mock = {
    prepare(query: string) {
      return new D1PreparedStatement(db.prepare(query));
    },
    async exec(query: string) {
      db.exec(query);
      return { count: 0, duration: 0 };
    },
    async batch() {
      return [];
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };

  return mock as unknown as D1Database;
}
