export interface IndexStorageProvider {
  addForDescendingOrder<T>(key: string, data: T): Promise<void>;
  set<T>(key: string, val: T): Promise<void>;
  setWithTxn<T>(
    key: string,
    txn: (val: T | null) => T | void | null,
  ): Promise<{ committed: boolean }>;
  remove(key: string): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  readItems<T>(key: string, limit?: number): Promise<T[] | null>;
}
