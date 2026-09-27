declare module 'sql.js' {
  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: any[]): this;
    prepare(sql: string, params?: any[]): {
      bind(values?: any[]): boolean;
      step(): boolean;
      getAsObject(params?: any[]): Record<string, any>;
      free(): boolean;
    };
    export(): Uint8Array;
    close(): void;
  }
  export default function initSqlJs(config?: any): Promise<{
    Database: typeof Database;
  }>;
}
