import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  CreateEmployeeRequestSchema,
  CreateLeaveRequestSchema,
  EmployeeListQuerySchema,
  EmployeeListSchema,
  EmployeeSchema,
  HttpErrorResponseSchema,
  LeaveDecisionRequestSchema,
  LeaveListQuerySchema,
  LeaveRequestPageSchema,
  LeaveRequestSchema,
  MyLeaveQuerySchema,
  PayrollSummaryQuerySchema,
  PayrollSummarySchema,
  UpdateEmployeeRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { HrService } from '../../services/hr.service.js';

const IdParam = z.object({ id: UuidSchema });
const authErrors = { 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema };
const errors = { 400: HttpErrorResponseSchema, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, ...authErrors };

/** Employees, leave and payroll (API_CONTRACT.md section 10.3). Owner only unless marked `:self`. */
export const hrRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new HrService(fastify.db, fastify.env.CLUB_TIMEZONE);
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
        description: 'Approve or reject a pending leave request. Approved leave may not overlap other approved leave.',
        tags: ['HR'],
        params: IdParam,
        body: LeaveDecisionRequestSchema,
        response: { 200: LeaveRequestSchema, ...errors },
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
        description: 'Your own leave requests.',
        tags: ['HR'],
        querystring: MyLeaveQuerySchema,
        response: { 200: LeaveRequestPageSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listMyLeave(request.user!.id, request.query.page, request.query.limit))
  );

  fastify.post(
    '/me/leave',
    {
      preHandler: [self('leave:create:self')],
      schema: {
        description: 'Ask for leave. Owners are notified.',
        tags: ['HR'],
        body: CreateLeaveRequestSchema,
        response: { 201: LeaveRequestSchema, ...errors },
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
};
