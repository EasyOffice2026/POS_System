import { describe, expect, it } from 'vitest';
import { isLocalDatabase } from './database-url';

describe('isLocalDatabase', () => {
  it.each([
    'postgresql://pos:pos@localhost:5432/pos',
    'postgres://postgres:postgres@localhost:51214/template1?sslmode=disable&schema=demo',
    'postgresql://pos:pos@127.0.0.1:5432/pos',
    'postgresql://pos:pos@[::1]:5432/pos',
    'postgresql://pos:pos@LOCALHOST/pos',
    'postgresql:///pos?host=/var/run/postgresql',
  ])('says %s is on this computer', (url) => {
    expect(isLocalDatabase(url)).toBe(true);
  });

  it.each([
    'postgresql://postgres.abcdefgh:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres',
    'postgresql://pos:pos@10.0.0.5:5432/pos',
    'postgresql://pos:pos@my-computer.local:5432/pos',
    'postgresql://pos:pos@localhost.example.com:5432/pos',
    'postgresql://pos:pos@127.0.0.1.example.com:5432/pos',
  ])('says %s is somewhere else', (url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });

  it('says an address that is not an address is not local', () => {
    expect(isLocalDatabase('not a url')).toBe(false);
    expect(isLocalDatabase('')).toBe(false);
  });
});
