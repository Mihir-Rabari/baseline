import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { employeeDocuments, employees } from '@packages/db';
import { EmployeeDocumentListSchema, EmployeeDocumentSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { detectDocument, safeFileName } from './lib/documents.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000ef';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

describe('document detection (unit)', () => {
  it('recognises PDF, JPEG and PNG by their bytes and refuses everything else', () => {
    expect(detectDocument(PDF)).toEqual({ contentType: 'application/pdf', ext: 'pdf' });
    expect(detectDocument(PNG)?.contentType).toBe('image/png');
    expect(detectDocument(JPEG)?.contentType).toBe('image/jpeg');
    for (const bad of [HTML, SVG, EXE, Buffer.alloc(0), Buffer.from('%PD'), Buffer.from(' %PDF-1.4')]) expect(detectDocument(bad)).toBeNull();
  });

  it('keeps stored names free of paths, quotes and control characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\secrets\\id card.pdf')).toBe('id card.pdf');
    expect(safeFileName('a"b\r\nSet-Cookie: x=1.pdf')).not.toMatch(/["\r\n]/);
    expect(safeFileName('...')).toBe('document');
    expect(safeFileName('x'.repeat(500))).toHaveLength(120);
  });
});

describe('Employee documents (#65)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  let owner: Actor;
  let desk: Actor;
  let bar: Actor;
  let member: Actor;
  let staffUser: Actor;
  const empIds: string[] = [];
  let mine: { id: string };
  let theirs: { id: string };
  const stored = new Map<string, Buffer>();

  const raw = (method: 'GET' | 'POST' | 'DELETE', url: string, actor?: Actor, body?: Buffer | string, type?: string) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...(actor ? { cookie: actor.cookie } : {}), ...(type ? { 'content-type': type } : {}) },
      ...(body !== undefined ? { payload: body } : {}),
    });
  const upload = (employeeId: string, body: Buffer | string, type: string, actor?: Actor, query = 'docType=ID_PROOF&fileName=aadhaar.pdf') =>
    raw('POST', `/hr/employees/${employeeId}/documents?${query}`, actor, body, type);

  async function employee(name: string, userId?: string) {
    const [row] = await fx.db
      .insert(employees)
      .values({ fullName: `${name} ${randomUUID().slice(0, 4)}`, position: 'Tester', department: 'BAR', monthlySalaryPaise: 1_000_000, hiredOn: '1990-01-01', userId: userId ?? null })
      .returning({ id: employees.id });
    empIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    // Object storage is replaced with a map so these tests do not need MinIO.
    vi.spyOn(app.storage, 'upload').mockImplementation(async (key, body) => {
      stored.set(key, Buffer.from(body as Buffer));
      return { key, bucket: 'test' };
    });
    vi.spyOn(app.storage, 'get').mockImplementation(async (key) => stored.get(key) ?? null);
    vi.spyOn(app.storage, 'delete').mockImplementation(async (key) => stored.delete(key));
    owner = await fx.actor(app, 'OWNER');
    desk = await fx.actor(app, 'FRONT_DESK');
    bar = await fx.actor(app, 'BAR_STAFF');
    member = await fx.actor(app, 'MEMBER');
    staffUser = await fx.actor(app, 'BAR_STAFF');
    mine = await employee('Docs Mine', staffUser.id);
    theirs = await employee('Docs Theirs');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (hasDatabase) {
      if (empIds.length) await fx.db.delete(employees).where(inArray(employees.id, empIds)); // documents cascade
      await fx.cleanup();
    }
    await app.close();
  });

  it('401 without a session on every document route', async () => {
    expect((await raw('GET', `/hr/employees/${NO_SUCH_UUID}/documents`)).statusCode).toBe(401);
    expect((await upload(NO_SUCH_UUID, PDF, 'application/pdf')).statusCode).toBe(401);
    expect((await raw('GET', `/hr/employees/${NO_SUCH_UUID}/documents/${NO_SUCH_UUID}/download`)).statusCode).toBe(401);
    expect((await raw('DELETE', `/hr/employees/${NO_SUCH_UUID}/documents/${NO_SUCH_UUID}`)).statusCode).toBe(401);
  });

  it('only the owner may list, upload, download or delete (403 for desk, bar, members and the employee themself)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const seeded = await upload(theirs.id, PDF, 'application/pdf', owner);
    expect(seeded.statusCode, seeded.body).toBe(201);
    const docId = seeded.json().id;
    for (const actor of [desk, bar, member, staffUser]) {
      expect((await raw('GET', `/hr/employees/${theirs.id}/documents`, actor)).statusCode).toBe(403);
      expect((await upload(theirs.id, PDF, 'application/pdf', actor)).statusCode).toBe(403);
      expect((await raw('GET', `/hr/employees/${theirs.id}/documents/${docId}/download`, actor)).statusCode).toBe(403);
      expect((await raw('DELETE', `/hr/employees/${theirs.id}/documents/${docId}`, actor)).statusCode).toBe(403);
    }
    // Not even for their own record: documents are an owner-only HR file.
    expect((await raw('GET', `/hr/employees/${mine.id}/documents`, staffUser)).statusCode).toBe(403);
    expect((await upload(mine.id, PDF, 'application/pdf', staffUser)).statusCode).toBe(403);
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents`, owner)).json()).toHaveLength(1);
  });

  it('400 for a bad id, an unknown document type, or a missing or oversized name', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await raw('GET', '/hr/employees/not-a-uuid/documents', owner)).statusCode).toBe(400);
    expect((await upload('not-a-uuid', PDF, 'application/pdf', owner)).statusCode).toBe(400);
    expect((await upload(theirs.id, PDF, 'application/pdf', owner, 'docType=SELFIE&fileName=a.pdf')).statusCode).toBe(400);
    expect((await upload(theirs.id, PDF, 'application/pdf', owner, 'docType=ID_PROOF')).statusCode).toBe(400);
    expect((await upload(theirs.id, PDF, 'application/pdf', owner, `docType=ID_PROOF&fileName=${'x'.repeat(121)}`)).statusCode).toBe(400);
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents/not-a-uuid/download`, owner)).statusCode).toBe(400);
    expect((await raw('DELETE', `/hr/employees/${theirs.id}/documents/not-a-uuid`, owner)).statusCode).toBe(400);
  });

  it('404 for an unknown employee or document', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await raw('GET', `/hr/employees/${NO_SUCH_UUID}/documents`, owner)).statusCode).toBe(404);
    expect((await upload(NO_SUCH_UUID, PDF, 'application/pdf', owner)).statusCode).toBe(404);
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents/${NO_SUCH_UUID}/download`, owner)).statusCode).toBe(404);
    expect((await raw('DELETE', `/hr/employees/${theirs.id}/documents/${NO_SUCH_UUID}`, owner)).statusCode).toBe(404);
  });

  it('415 for a content type that is not a document, 422 when the bytes are not what they claim', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await upload(theirs.id, 'hello', 'text/plain', owner)).statusCode).toBe(415);
    expect((await upload(theirs.id, SVG, 'image/svg+xml', owner)).statusCode).toBe(415);
    expect((await upload(theirs.id, EXE, 'application/octet-stream', owner)).statusCode).toBe(415);
    expect((await upload(theirs.id, HTML, 'text/html', owner)).statusCode).toBe(415);
    for (const [body, type] of [[HTML, 'application/pdf'], [SVG, 'image/png'], [EXE, 'application/pdf'], [PNG, 'application/pdf'], [PDF, 'image/png'], [JPEG, 'image/png']] as const) {
      const res = await upload(theirs.id, body, type, owner);
      expect(res.statusCode, `${type} ${body.subarray(0, 4).toString('latin1')}`).toBe(422);
    }
    expect((await upload(theirs.id, Buffer.alloc(0), 'application/pdf', owner)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('413 for a file over 10 MB, and nothing is stored', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const before = stored.size;
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(theirs.id, big, 'application/pdf', owner)).statusCode).toBe(413);
    expect(stored.size).toBe(before);
  });

  it('uploads, lists, downloads and deletes a document; the stored name is generated and the file is removed', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = await upload(theirs.id, PNG, 'image/png', owner, `docType=ADDRESS_PROOF&fileName=${encodeURIComponent('../../etc/passwd')}`);
    expect(created.statusCode, created.body).toBe(201);
    const doc = EmployeeDocumentSchema.parse(created.json());
    expect(doc).toMatchObject({ employeeId: theirs.id, docType: 'ADDRESS_PROOF', fileName: 'passwd', contentType: 'image/png', sizeBytes: PNG.length });
    expect(created.body).not.toContain('employee-documents/'); // the storage key is never exposed
    const [row] = await fx.db.select().from(employeeDocuments).where(eq(employeeDocuments.id, doc.id));
    expect(row.storageKey).toMatch(new RegExp(`^employee-documents/${theirs.id}/[0-9a-f-]{36}\\.png$`));
    expect(stored.get(row.storageKey)?.equals(PNG)).toBe(true);

    const listed = EmployeeDocumentListSchema.parse((await raw('GET', `/hr/employees/${theirs.id}/documents`, owner)).json());
    expect(listed.map((d) => d.id)).toContain(doc.id);

    const download = await raw('GET', `/hr/employees/${theirs.id}/documents/${doc.id}/download`, owner);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(PNG)).toBe(true);
    expect(download.headers['content-type']).toBe('image/png');
    expect(String(download.headers['content-disposition'])).toMatch(/^attachment; filename="passwd"/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toBe('no-store');

    const removed = await raw('DELETE', `/hr/employees/${theirs.id}/documents/${doc.id}`, owner);
    expect(removed.statusCode).toBe(204);
    expect(stored.has(row.storageKey)).toBe(false);
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents/${doc.id}/download`, owner)).statusCode).toBe(404);
    expect((await raw('DELETE', `/hr/employees/${theirs.id}/documents/${doc.id}`, owner)).statusCode).toBe(404);
  });

  it("a document cannot be reached or deleted through another employee's record", async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = await upload(mine.id, PDF, 'application/pdf', owner);
    const docId = created.json().id;
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents/${docId}/download`, owner)).statusCode).toBe(404);
    expect((await raw('DELETE', `/hr/employees/${theirs.id}/documents/${docId}`, owner)).statusCode).toBe(404);
    expect((await raw('GET', `/hr/employees/${mine.id}/documents`, owner)).json().map((d: { id: string }) => d.id)).toContain(docId);
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents`, owner)).json().map((d: { id: string }) => d.id)).not.toContain(docId);
  });

  it('a stored name cannot inject headers, and a missing stored file is a 404 not a crash', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = await upload(theirs.id, PDF, 'application/pdf', owner, `docType=OTHER&fileName=${encodeURIComponent('evil"\r\nSet-Cookie: x=1.pdf')}`);
    expect(created.statusCode, created.body).toBe(201);
    const { id, fileName } = created.json();
    expect(fileName).not.toMatch(/["\r\n]/);
    const download = await raw('GET', `/hr/employees/${theirs.id}/documents/${id}/download`, owner);
    expect(download.headers['set-cookie']).toBeUndefined();
    const [row] = await fx.db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id));
    stored.delete(row.storageKey);
    expect((await raw('GET', `/hr/employees/${theirs.id}/documents/${id}/download`, owner)).statusCode).toBe(404);
  });

  it('caps the number of documents per employee at 25 (422)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const target = await employee('Docs Capped');
    const rows = Array.from({ length: 25 }, (_, i) => ({
      employeeId: target.id,
      docType: 'OTHER' as const,
      fileName: `f${i}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `employee-documents/${target.id}/${randomUUID()}.pdf`,
    }));
    await fx.db.insert(employeeDocuments).values(rows);
    const res = await upload(target.id, PDF, 'application/pdf', owner);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('DOCUMENT_LIMIT_REACHED');
  });
});
