import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PreconditionFailedError } from '../src/ports';
import { D1DocStore } from '../src/store/d1-store';
import { ReadCache, Repos } from '../src/store/repos';

/** The slice of the D1 API the store uses, over Node's SQLite (D1 is SQLite). Not real D1. */
function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: (string | number)[] = [];
    const stmt = {
      bind: (...a: (string | number)[]) => ((args = a), stmt),
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

describe('D1 document store', () => {
  it('creates once, then updates only against the current eTag', async () => {
    const store = new D1DocStore(fakeD1());
    expect(await store.getJson('a/doc.json')).toBeNull();
    const { etag } = await store.putJson('a/doc.json', { n: 1 }, { ifNoneMatch: '*' });
    await expect(store.putJson('a/doc.json', { n: 9 }, { ifNoneMatch: '*' })).rejects.toThrow(
      PreconditionFailedError,
    );
    const next = await store.putJson('a/doc.json', { n: 2 }, { ifMatch: etag });
    await expect(store.putJson('a/doc.json', { n: 3 }, { ifMatch: etag })).rejects.toThrow(
      PreconditionFailedError,
    );
    expect(await store.getJson('a/doc.json')).toEqual({ data: { n: 2 }, etag: next.etag });
  });

  it('lists immediate child folders under a prefix', async () => {
    const store = new D1DocStore(fakeD1());
    for (const p of ['Projects/A/project.json', 'Projects/B/project.json', 'Projectsx/C/p.json'])
      await store.putJson(p, {}, { ifNoneMatch: '*' });
    expect((await store.listFolders('Projects')).sort()).toEqual(['A', 'B']);
  });

  it('keeps every concurrent read-modify-write through Repos.update', async () => {
    const repos = new Repos(new D1DocStore(fakeD1()), new ReadCache(), 50);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        repos.update<{ n: number }, void>(
          'counter.json',
          () => ({ n: 0 }),
          (d) => {
            d.n += 1;
          },
        ),
      ),
    );
    expect((await repos.store.getJson<{ n: number }>('counter.json'))?.data.n).toBe(10);
  });
});
