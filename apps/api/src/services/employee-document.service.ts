import { randomUUID } from 'node:crypto';
import { and, count, desc, eq } from 'drizzle-orm';
import { currentTenantScope, employeeDocuments, employees } from '@packages/db';
import {
  EMPLOYEE_DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENTS_PER_EMPLOYEE,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
  type EmployeeDocument,
  type UploadEmployeeDocumentQuery,
} from '@packages/validation';
import type { IStorageService } from '@packages/shared';
import { DomainError } from '../lib/domain-error.js';
import { detectDocument, safeFileName } from '../lib/documents.js';
import { tenantPrefix } from '../lib/storage-keys.js';
import type { DbExecutor } from './db-types.js';

type Row = typeof employeeDocuments.$inferSelect;

const KEY_PREFIX = 'employee-documents';

/**
 * Files on an employee's record. Bytes live in object storage under a generated key (never the
 * uploaded name); the database row is what authorises access, and every lookup is scoped to the
 * employee in the URL so a document id from another record cannot be reached through this one.
 */
export class EmployeeDocumentService {
  constructor(
    private readonly db: DbExecutor,
    private readonly storage: IStorageService
  ) {}

  private dto(row: Row): EmployeeDocument {
    return {
      id: row.id,
      employeeId: row.employeeId,
      docType: row.docType,
      fileName: row.fileName,
      contentType: row.contentType as EmployeeDocument['contentType'],
      sizeBytes: row.sizeBytes,
      uploadedAt: row.createdAt.toISOString(),
    };
  }

  private async assertEmployee(employeeId: string) {
    const [row] = await this.db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Employee not found.');
  }

  private async find(employeeId: string, id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(employeeDocuments)
      .where(and(eq(employeeDocuments.id, id), eq(employeeDocuments.employeeId, employeeId)))
      .limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Document not found.');
    return row;
  }

  async list(employeeId: string): Promise<EmployeeDocument[]> {
    await this.assertEmployee(employeeId);
    const rows = await this.db
      .select()
      .from(employeeDocuments)
      .where(eq(employeeDocuments.employeeId, employeeId))
      .orderBy(desc(employeeDocuments.createdAt), desc(employeeDocuments.id));
    return rows.map((row) => this.dto(row));
  }

  async upload(employeeId: string, query: UploadEmployeeDocumentQuery, body: unknown, declaredType: string, actorId: string): Promise<EmployeeDocument> {
    await this.assertEmployee(employeeId);
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 415, 'Send the document as a PDF, JPEG, PNG or WebP file.');
    }
    if (body.length > MAX_EMPLOYEE_DOCUMENT_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 413, 'Documents can be at most 10 MB.');
    const detected = detectDocument(body);
    if (!detected) throw new DomainError('INVALID_DOCUMENT', 422, 'That file is not a PDF, JPEG, PNG or WebP document.');
    if (declaredType !== detected.contentType || !(EMPLOYEE_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(declaredType)) {
      throw new DomainError('INVALID_DOCUMENT', 422, 'The file contents do not match the declared document type.');
    }
    const [existing] = await this.db.select({ n: count() }).from(employeeDocuments).where(eq(employeeDocuments.employeeId, employeeId));
    if ((existing?.n ?? 0) >= MAX_DOCUMENTS_PER_EMPLOYEE) {
      throw new DomainError('DOCUMENT_LIMIT_REACHED', 422, `An employee can have at most ${MAX_DOCUMENTS_PER_EMPLOYEE} documents. Delete one first.`);
    }

    // Namespaced by club like every other stored object (the club is the request's scope).
    const scope = currentTenantScope();
    const storageKey = `${scope ? tenantPrefix(scope) : ''}${KEY_PREFIX}/${employeeId}/${randomUUID()}.${detected.ext}`;
    await this.storage.upload(storageKey, body, { contentType: detected.contentType, metadata: { uploader: actorId } });
    try {
      const [row] = await this.db
        .insert(employeeDocuments)
        .values({
          employeeId,
          docType: query.docType,
          fileName: safeFileName(query.fileName),
          contentType: detected.contentType,
          sizeBytes: body.length,
          storageKey,
          uploadedBy: actorId,
        })
        .returning();
      return this.dto(row);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => false);
      throw error;
    }
  }

  async download(employeeId: string, id: string): Promise<{ doc: EmployeeDocument; bytes: Buffer }> {
    const row = await this.find(employeeId, id);
    const bytes = await this.storage.get(row.storageKey);
    if (!bytes) throw new DomainError('NOT_FOUND', 404, 'The stored file is missing.');
    return { doc: this.dto(row), bytes };
  }

  async remove(employeeId: string, id: string): Promise<EmployeeDocument> {
    const row = await this.find(employeeId, id);
    await this.db.delete(employeeDocuments).where(eq(employeeDocuments.id, row.id));
    // The record is gone either way; a failed storage delete only leaves an unreachable object.
    await this.storage.delete(row.storageKey).catch(() => false);
    return this.dto(row);
  }
}
