import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../src/lib/legacyCompatibility.ts', import.meta.url), 'utf8');
const { resolveLegacyCompatibility: resolve, LEGACY_DESTINATIONS } = await import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(source)));
test('missing origin gives no inferred address', () => {
  assert.deepEqual(resolve(undefined), { status: 'missing' });
  assert.deepEqual(resolve(''), { status: 'missing' });
});
test('explicit HTTPS and literal HTTP loopback origins normalize safely', () => {
  for (const [input, origin] of [['https://legacy.example.test/','https://legacy.example.test'],['http://localhost:8787','http://localhost:8787'],['http://127.0.0.1:8787/','http://127.0.0.1:8787'],['http://[::1]:8787','http://[::1]:8787']]) {
    assert.deepEqual(resolve(input), { status: 'configured', origin });
    for (const destination of Object.values(LEGACY_DESTINATIONS)) {
      const link = new URL(origin + destination.path);
      assert.equal(link.origin, origin);
      assert.match(link.pathname, /^\/dashboard(?:\/|$)/);
      assert.equal(link.search, ''); assert.equal(link.hash, '');
    }
  }
});
test('credentials, arbitrary HTTP hosts, paths and URL ambiguity never yield a link', () => {
  for (const value of [' ', 'https://user:secret@legacy.example.test','https://user@legacy.example.test','http://legacy.example.test','//legacy.example.test','javascript:alert(1)','https://legacy.example.test/api','https://legacy.example.test//','https://legacy.example.test?next=https://evil.test','https://legacy.example.test?','https://legacy.example.test#','https://legacy.example.test/#x','https://legacy.example.test\\evil','https://legacy.example.test/%2f','http://127.1:8787','http://2130706433:8787','http://localhost.evil.test:8787','http://localhost:0','https://legacy.example.test:65536','https://legacy.example.test\n','https://'+'a'.repeat(2048)]) {
    assert.deepEqual(resolve(value), { status: 'invalid' }, value);
  }
});
test('raw dot paths cannot normalize into an accepted origin', () => {
  for (const suffix of ['/.','/..','/../','/path/..','/path/../','/./','/path/../.']) {
    for (const origin of ['https://legacy.example.test','http://127.0.0.1:8787']) {
      assert.deepEqual(resolve(origin + suffix), {status:'invalid'}, origin + suffix);
    }
  }
  for (const origin of ['https://legacy.example.test','https://legacy.example.test:443','http://127.0.0.1:8787']) {
    for (const suffix of ['', '/']) assert.equal(resolve(origin + suffix).status, 'configured');
  }
});
test('raw C0/DEL controls and empty userinfo are rejected before normalization', () => {
  for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
    const control = String.fromCharCode(code);
    for (const value of [control + 'https://a.test', 'https://' + control + 'a.test', 'https://a.test' + control]) assert.deepEqual(resolve(value), { status: 'invalid' });
  }
  for (const value of ['https://@a.test', 'https://@a.test/', 'https://:@a.test', 'https://user@a.test', 'https://user:@a.test', 'https://:pass@a.test', 'http://@localhost']) assert.deepEqual(resolve(value), { status: 'invalid' });
  assert.deepEqual(resolve('https://a.test/'), { status: 'configured', origin: 'https://a.test' });
  assert.deepEqual(resolve('http://localhost:3000'), { status: 'configured', origin: 'http://localhost:3000' });
});
