'use client';

import React, { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileUp, Trash2 } from 'lucide-react';
import type { EmployeeDocument, EmployeeDocumentType } from '@packages/validation';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { DOCUMENT_ACCEPT, DOCUMENT_TYPE_LABELS, documentDownloadUrl, documentProblem, formatBytes, uploadEmployeeDocument } from '@/lib/document-api';
import { ConfirmRemoveDialog } from '@/components/club/confirm-remove-dialog';
import { errorText } from '@/components/club/form-dialog';
import { QueryState, SelectBox } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEY = 'hr-employee';
const TYPE_OPTIONS = (Object.keys(DOCUMENT_TYPE_LABELS) as EmployeeDocumentType[]).map((value) => ({ value, label: DOCUMENT_TYPE_LABELS[value] }));

/** An employee's documents: upload, list, download and delete. Owner only; the caller decides whether to render it. */
export function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const typeId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<EmployeeDocumentType>('ID_PROOF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EmployeeDocument | null>(null);
  const docs = useOpsQuery<EmployeeDocument[]>([KEY, 'documents', employeeId], `/hr/employees/${employeeId}/documents`);
  const remove = useOpsMutation<unknown, { id: string }>('delete', [KEY], (v) => `/hr/employees/${employeeId}/documents/${v.id}`);

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow picking the same file again after an error
    if (!file) return;
    const problem = documentProblem(file);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      await uploadEmployeeDocument(employeeId, docType, file);
      await docs.refetch();
      toast.success('Document uploaded');
    } catch (caught) { setError(errorText(caught, 'Could not upload the document.')); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="documents-heading" className="space-y-4">
      <h2 id="documents-heading" className="text-lg font-semibold">Documents</h2>
      <div className="flex flex-wrap items-end gap-3">
        <SelectBox id={typeId} label="Document type" value={docType} onChange={(v) => setDocType(v as EmployeeDocumentType)} options={TYPE_OPTIONS} className="w-48" />
        <Button type="button" variant="outline" loading={busy} disabled={busy} onClick={() => input.current?.click()}><FileUp className="mr-2 h-4 w-4" aria-hidden />Upload document</Button>
        <input ref={input} type="file" aria-label="Choose a document file" accept={DOCUMENT_ACCEPT} className="sr-only" onChange={(e) => { void pick(e); }} />
      </div>
      <p className="text-xs text-muted-foreground">PDF, JPEG, PNG or WebP, up to 10 MB each. Only the owner can see these.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <QueryState query={{ ...docs, isEmpty: !docs.data?.length }} empty={{ title: 'No documents yet', description: 'Upload an ID proof, contract or certificate to keep it with this employee.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Added</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {docs.data?.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.fileName}</TableCell>
                <TableCell><Badge variant="outline">{DOCUMENT_TYPE_LABELS[d.docType]}</Badge></TableCell>
                <TableCell>{formatBytes(d.sizeBytes)}</TableCell>
                <TableCell>{d.uploadedAt.slice(0, 10)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  <a className={buttonVariants({ size: 'sm', variant: 'outline' })} aria-label={`Download ${d.fileName}`} href={documentDownloadUrl(employeeId, d.id)}>Download</a>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${d.fileName}`} onClick={() => setRemoving(d)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
      <ConfirmRemoveDialog
        open={Boolean(removing)}
        title="Delete this document?"
        description={removing ? `${removing.fileName} will be permanently removed from this employee's record.` : ''}
        confirmLabel="Delete"
        onConfirm={async () => { if (removing) { await remove.mutateAsync({ id: removing.id }); toast.success('Document deleted'); } }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
