import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  BankDetailsSchema,
  CreateEmployeeRequestSchema,
  CreatePayrollRunRequestSchema,
  PayrollRunDetailSchema,
  PayrollRunListSchema,
  PayslipListSchema,
  PayslipSchema,
  UpdateBankDetailsRequestSchema,
  UpdatePayslipRequestSchema,
  CreateLeaveRequestSchema,
  EmployeeListQuerySchema,
  EmployeeListSchema,
  EmployeeSchema,
  EmployeeProfileSchema,
  EmployeeDocumentListSchema,
  EmployeeDocumentSchema,
  EMPLOYEE_DOCUMENT_CONTENT_TYPES,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
  UploadEmployeeDocumentQuerySchema,
  HttpErrorResponseSchema,
  LeaveDecisionRequestSchema,
  LeaveListQuerySchema,
  LeaveRequestPageSchema,
  LeaveRequestSchema,
  MyLeaveQuerySchema,
  MyLeavePageSchema,
  PayrollSummaryQuerySchema,
  PayrollSummarySchema,
  UpdateEmployeeRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { EmployeeDocumentService } from '../../services/employee-document.service.js';
import { HrService } from '../../services/hr.service.js';
import { PayrollService } from '../../services/payroll.service.js';

const IdParam = z.object({ id: UuidSchema });
const authErrors = { 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema };
const errors = { 400: HttpErrorResponseSchema, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, ...authErrors };

/** Employees, leave and payroll (API_CONTRACT.md section 10.3). Owner only unless marked `:self`. */
export const hrRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new HrService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const payroll = new PayrollService(fastify.db, fastify.env.CLUB_TIMEZONE, fastify.env.SESSION_SECRET);
  const documents = new EmployeeDocumentService(fastify.db, fastify.storage);
  const self = (action: 'leave:read:self' | 'leave:create:self') =>
    requirePermission(action, (req) => ({ resourceOwnerId: req.user?.id }));

  fastify.get(
    '/hr/employees',
    {
      preHandler: [requirePermission('hr:read')],
      schema: {
        description: 'Employees with their leave days taken this year.',
        tags: ['HR'],
        querystring: EmployeeListQuerySchema,
        response: { 200: EmployeeListSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listEmployees(request.query))
  );

  fastify.get(
    '/hr/employees/:id',
    {
      preHandler: [requirePermission('hr:read')],
      schema: {
        description: "One employee's profile: details, photo and leave summary. Bank details are a separate masked call.",
        tags: ['HR'],
        params: IdParam,
        response: { 200: EmployeeProfileSchema, ...errors },
      },
    },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await service.getEmployeeProfile(request.params.id))
  );

  fastify.post(
    '/hr/employees',
    {
      preHandler: [requirePermission('hr:manage')],
      schema: {
        description: 'Add an employee, optionally linked to a login.',
        tags: ['HR'],
        body: CreateEmployeeRequestSchema,
        response: { 201: EmployeeSchema, ...errors },
      },
    },
    async (request, reply) => {
      const employee = await service.createEmployee(request.body);
      request.log.info({ employeeId: employee.id, actorId: request.user!.id }, 'Employee created');
      return reply.status(201).send(employee);
    }
  );

  fastify.put(
    '/hr/employees/:id',
    {
      preHandler: [requirePermission('hr:manage')],
      schema: {
        description: 'Change any subset of an employee, including status.',
        tags: ['HR'],
        params: IdParam,
        body: UpdateEmployeeRequestSchema,
        response: { 200: EmployeeSchema, ...errors },
      },
    },
    async (request, reply) => {
      const employee = await service.updateEmployee(request.params.id, request.body);
      request.log.info({ employeeId: employee.id, actorId: request.user!.id }, 'Employee updated');
      return reply.send(employee);
    }
  );

  fastify.get(
    '/hr/leave',
    {
      preHandler: [requirePermission('leave:read')],
      schema: {
        description: 'All leave requests, newest first.',
        tags: ['HR'],
        querystring: LeaveListQuerySchema,
        response: { 200: LeaveRequestPageSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listLeave(request.query))
  );

  fastify.post(
    '/hr/leave/:id/decision',
    {
      preHandler: [requirePermission('leave:decide')],
      schema: {
        description: 'Approve or reject a pending leave request. Approved leave may not overlap other approved leave, and may not exceed the yearly allowance (422).',
        tags: ['HR'],
        params: IdParam,
        body: LeaveDecisionRequestSchema,
        response: { 200: LeaveRequestSchema, 422: HttpErrorResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const leave = await service.decideLeave(request.params.id, request.body, request.user!.id);
      request.log.info({ leaveRequestId: leave.id, decision: leave.status, actorId: request.user!.id }, 'Leave decided');
      await fastify.iamService.logAuditEvent({
        action: 'LEAVE_DECIDED',
        actor: request.user!.id,
        target: leave.id,
        details: { decision: leave.status },
      });
      return reply.send(leave);
    }
  );

  fastify.get(
    '/me/leave',
    {
      preHandler: [self('leave:read:self')],
      schema: {
        description: 'Your own leave requests, with your leave balance for this year (allowance, taken, pending, remaining).',
        tags: ['HR'],
        querystring: MyLeaveQuerySchema,
        response: { 200: MyLeavePageSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listMyLeave(request.user!.id, request.query.page, request.query.limit))
  );

  fastify.post(
    '/me/leave',
    {
      preHandler: [self('leave:create:self')],
      schema: {
        description: 'Ask for leave. Owners are notified. 422 when it would take you past your yearly allowance.',
        tags: ['HR'],
        body: CreateLeaveRequestSchema,
        response: { 201: LeaveRequestSchema, 422: HttpErrorResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const leave = await service.requestLeave(request.user!.id, request.body);
      request.log.info({ leaveRequestId: leave.id, actorId: request.user!.id }, 'Leave requested');
      return reply.status(201).send(leave);
    }
  );

  fastify.get(
    '/hr/payroll-summary',
    {
      preHandler: [requirePermission('hr:read')],
      schema: {
        description: 'Monthly payroll: active staff hired by month end, by department, and who is on approved leave.',
        tags: ['HR'],
        querystring: PayrollSummaryQuerySchema,
        response: { 200: PayrollSummarySchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.payrollSummary(request.query.month))
  );

  // ---------------------------------------------------------------------------
  // Bank details, payroll runs and payslips. Owner only (`hr:manage`), except an employee's own
  // finalised payslips. The account number is never returned: only its last four digits.
  // ---------------------------------------------------------------------------
  const manage = [requirePermission('hr:manage')];
  const SlipParam = z.object({ id: UuidSchema });

  fastify.get(
    '/hr/employees/:id/bank',
    {
      preHandler: manage,
      schema: { description: "An employee's bank details with the account number masked.", tags: ['HR'], params: IdParam, response: { 200: BankDetailsSchema, ...errors } },
    },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await payroll.getBank(request.params.id))
  );

  fastify.put(
    '/hr/employees/:id/bank',
    {
      preHandler: manage,
      schema: { description: 'Set or replace the payout details. The account number is stored encrypted.', tags: ['HR'], params: IdParam, body: UpdateBankDetailsRequestSchema, response: { 200: BankDetailsSchema, ...errors } },
    },
    async (request, reply) => {
      const result = await payroll.setBank(request.params.id, request.body, request.user!.id);
      // Audit that it changed, never what it changed to.
      await fastify.iamService.logAuditEvent({ action: 'EMPLOYEE_BANK_UPDATED', actor: request.user!.id, target: request.params.id, details: {} });
      request.log.info({ employeeId: request.params.id, actorId: request.user!.id }, 'Employee bank details updated');
      return reply.header('cache-control', 'no-store').send(result);
    }
  );

  fastify.get(
    '/hr/employees/:id/payslips',
    {
      preHandler: manage,
      schema: { description: "All of one employee's payslips, newest month first.", tags: ['HR'], params: IdParam, response: { 200: PayslipListSchema, ...errors } },
    },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await payroll.employeeSlips(request.params.id))
  );

  fastify.get(
    '/hr/payroll/runs',
    { preHandler: manage, schema: { description: 'Payroll runs, newest month first.', tags: ['HR'], response: { 200: PayrollRunListSchema, ...authErrors } } },
    async (_request, reply) => reply.header('cache-control', 'no-store').send(await payroll.listRuns())
  );

  fastify.post(
    '/hr/payroll/runs',
    {
      preHandler: manage,
      schema: { description: 'Start a draft payroll run for a month from active staff, with leave and attendance figures.', tags: ['HR'], body: CreatePayrollRunRequestSchema, response: { 201: PayrollRunDetailSchema, 422: HttpErrorResponseSchema, ...errors } },
    },
    async (request, reply) => {
      const run = await payroll.createRun(request.body.month, request.user!.id);
      await fastify.iamService.logAuditEvent({ action: 'PAYROLL_RUN_CREATED', actor: request.user!.id, target: run.id, details: { month: run.month } });
      return reply.status(201).header('cache-control', 'no-store').send(run);
    }
  );

  fastify.get(
    '/hr/payroll/runs/:id',
    { preHandler: manage, schema: { description: 'A payroll run with every payslip.', tags: ['HR'], params: IdParam, response: { 200: PayrollRunDetailSchema, ...errors } } },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await payroll.getRun(request.params.id))
  );

  fastify.delete(
    '/hr/payroll/runs/:id',
    { preHandler: manage, schema: { description: 'Discard a draft run.', tags: ['HR'], params: IdParam, response: { 204: z.null(), ...errors } } },
    async (request, reply) => {
      await payroll.deleteRun(request.params.id);
      await fastify.iamService.logAuditEvent({ action: 'PAYROLL_RUN_DELETED', actor: request.user!.id, target: request.params.id, details: {} });
      return reply.status(204).send(null);
    }
  );

  fastify.put(
    '/hr/payroll/slips/:id',
    {
      preHandler: manage,
      schema: { description: 'Adjust unpaid leave, bonus, other deductions or the note on a draft payslip.', tags: ['HR'], params: SlipParam, body: UpdatePayslipRequestSchema, response: { 200: PayslipSchema, 422: HttpErrorResponseSchema, ...errors } },
    },
    async (request, reply) => {
      const slip = await payroll.updateSlip(request.params.id, request.body);
      await fastify.iamService.logAuditEvent({ action: 'PAYSLIP_ADJUSTED', actor: request.user!.id, target: slip.id, details: { fields: Object.keys(request.body) } });
      return reply.header('cache-control', 'no-store').send(slip);
    }
  );

  fastify.post(
    '/hr/payroll/runs/:id/finalize',
    { preHandler: manage, schema: { description: 'Freeze a draft run. Payslips become visible to the employees.', tags: ['HR'], params: IdParam, response: { 200: PayrollRunDetailSchema, ...errors } } },
    async (request, reply) => {
      const run = await payroll.finalize(request.params.id);
      await fastify.iamService.logAuditEvent({ action: 'PAYROLL_RUN_FINALIZED', actor: request.user!.id, target: run.id, details: { month: run.month, totalNetPaise: run.totalNetPaise } });
      return reply.header('cache-control', 'no-store').send(run);
    }
  );

  fastify.post(
    '/hr/payroll/runs/:id/pay',
    { preHandler: manage, schema: { description: 'Mark a finalised run as paid out.', tags: ['HR'], params: IdParam, response: { 200: PayrollRunDetailSchema, ...errors } } },
    async (request, reply) => {
      const run = await payroll.markPaid(request.params.id);
      await fastify.iamService.logAuditEvent({ action: 'PAYROLL_RUN_PAID', actor: request.user!.id, target: run.id, details: { month: run.month } });
      return reply.header('cache-control', 'no-store').send(run);
    }
  );

  // ---------------------------------------------------------------------------
  // Employee documents (ID proof, contract...). Owner only. The file is the raw request body; its type
  // is decided from its own bytes, and downloads are always attachments.
  // ---------------------------------------------------------------------------
  for (const type of EMPLOYEE_DOCUMENT_CONTENT_TYPES) {
    fastify.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_EMPLOYEE_DOCUMENT_BYTES }, (_req, body, done) => done(null, body));
  }
  const DocParam = z.object({ id: UuidSchema, docId: UuidSchema });
  const docErrors = { 413: HttpErrorResponseSchema, 415: HttpErrorResponseSchema, 422: HttpErrorResponseSchema, ...errors };

  fastify.get(
    '/hr/employees/:id/documents',
    {
      preHandler: manage,
      schema: { description: "An employee's documents, newest first.", tags: ['HR'], params: IdParam, response: { 200: EmployeeDocumentListSchema, ...errors } },
    },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await documents.list(request.params.id))
  );

  fastify.post(
    '/hr/employees/:id/documents',
    {
      bodyLimit: MAX_EMPLOYEE_DOCUMENT_BYTES,
      preHandler: manage,
      schema: {
        description: 'Upload one document (PDF, JPEG, PNG or WebP, at most 10 MB) as the raw request body.',
        tags: ['HR'],
        params: IdParam,
        querystring: UploadEmployeeDocumentQuerySchema,
        response: { 201: EmployeeDocumentSchema, ...docErrors },
      },
    },
    async (request, reply) => {
      const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim();
      const doc = await documents.upload(request.params.id, request.query, request.body, declared, request.user!.id);
      await fastify.iamService.logAuditEvent({ action: 'EMPLOYEE_DOCUMENT_ADDED', actor: request.user!.id, target: request.params.id, details: { documentId: doc.id, docType: doc.docType } });
      request.log.info({ employeeId: doc.employeeId, documentId: doc.id, bytes: doc.sizeBytes, actorId: request.user!.id }, 'Employee document uploaded');
      return reply.status(201).header('cache-control', 'no-store').send(doc);
    }
  );

  fastify.get(
    '/hr/employees/:id/documents/:docId/download',
    { preHandler: manage, schema: { description: 'Download one document as an attachment.', tags: ['HR'], params: DocParam, response: errors } },
    async (request, reply) => {
      const { doc, bytes } = await documents.download(request.params.id, request.params.docId);
      const ascii = doc.fileName.replace(/[^ -~]/g, '_').replace(/"/g, '_');
      return reply
        .header('content-type', doc.contentType)
        .header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`)
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(bytes as never);
    }
  );

  fastify.delete(
    '/hr/employees/:id/documents/:docId',
    { preHandler: manage, schema: { description: 'Delete one document and its stored file.', tags: ['HR'], params: DocParam, response: { 204: z.null(), ...errors } } },
    async (request, reply) => {
      const doc = await documents.remove(request.params.id, request.params.docId);
      await fastify.iamService.logAuditEvent({ action: 'EMPLOYEE_DOCUMENT_DELETED', actor: request.user!.id, target: request.params.id, details: { documentId: doc.id, docType: doc.docType } });
      return reply.status(204).send(null);
    }
  );

  const sendPdf = (reply: import('fastify').FastifyReply, file: { filename: string; body: Buffer }) =>
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .header('cache-control', 'no-store')
      .send(file.body);

  fastify.get(
    '/hr/payroll/slips/:id/pdf',
    { preHandler: manage, schema: { description: 'Download a payslip as PDF.', tags: ['HR'], params: SlipParam, response: errors } },
    async (request, reply) => sendPdf(reply, await payroll.pdf(request.params.id, {}))
  );

  const mySlips = requirePermission('leave:read:self', (req) => ({ resourceOwnerId: req.user?.id }));
  fastify.get(
    '/me/payslips',
    { preHandler: [mySlips], schema: { description: 'My own finalised payslips.', tags: ['HR'], response: { 200: PayslipListSchema, ...authErrors } } },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await payroll.mySlips(request.user!.id))
  );
  fastify.get(
    '/me/payslips/:id/pdf',
    { preHandler: [mySlips], schema: { description: 'Download one of my own finalised payslips as PDF.', tags: ['HR'], params: SlipParam, response: errors } },
    async (request, reply) => sendPdf(reply, await payroll.pdf(request.params.id, { userId: request.user!.id }))
  );
};
