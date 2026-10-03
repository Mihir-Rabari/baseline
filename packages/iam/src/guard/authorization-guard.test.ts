import { describe, it, expect, vi } from 'vitest';
import { requireAuthentication, requirePermission, requireAnyPermission } from './authorization-guard.js';

describe('Authorization Route Guards', () => {
  const createMockRequest = (user?: any, iamService?: any, effectiveStatements?: any[]) => ({
    user,
    session: user ? { id: 'session-123' } : undefined,
    server: { iamService },
    effectiveStatements,
    log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
    id: 'test-req-123',
  });

  const createMockReply = () => {
    const reply: any = {};
    reply.status = vi.fn().mockReturnValue(reply);
    reply.send = vi.fn().mockReturnValue(reply);
    return reply;
  };

  describe('requireAuthentication', () => {
    it('should allow authenticated active users to pass through', async () => {
      const guard = requireAuthentication();
      const req = createMockRequest({ id: 'user-1', status: 'ACTIVE' });
      const reply = createMockReply();

      await guard(req as any, reply as any);

      expect(reply.status).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const guard = requireAuthentication();
      const req = createMockRequest(undefined);
      const reply = createMockReply();

      await guard(req as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
      );
    });
  });

  describe('requirePermission', () => {
    it('should allow ROOT users unconditionally', async () => {
      const mockIamService = {
        getUserStatements: vi.fn().mockResolvedValue([]),
      };
      const guard = requirePermission('admin:access');
      const req = createMockRequest(
        { id: 'root-user', identityType: 'ROOT', status: 'ACTIVE' },
        mockIamService
      );
      const reply = createMockReply();

      await guard(req as any, reply as any);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should evaluate permission statements for external users', async () => {
      const mockIamService = {
        getUserStatements: vi.fn().mockResolvedValue([
          { effect: 'allow', actions: ['users:read'], resources: ['*'] },
        ]),
      };
      const guard = requirePermission('users:read');
      const req = createMockRequest(
        { id: 'user-1', identityType: 'EXTERNAL_USER', status: 'ACTIVE' },
        mockIamService
      );
      const reply = createMockReply();

      await guard(req as any, reply as any);

      expect(mockIamService.getUserStatements).toHaveBeenCalledWith('user-1');
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should deny unauthorized external users with 403 FORBIDDEN', async () => {
      const mockIamService = {
        getUserStatements: vi.fn().mockResolvedValue([]),
      };
      const guard = requirePermission('admin:access');
      const req = createMockRequest(
        { id: 'user-1', identityType: 'EXTERNAL_USER', status: 'ACTIVE' },
        mockIamService
      );
      const reply = createMockReply();

      await guard(req as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'FORBIDDEN',
        })
      );
    });
  });

  describe('requireAnyPermission', () => {
    it('should allow if at least one permission succeeds', async () => {
      const mockIamService = {
        getUserStatements: vi.fn().mockResolvedValue([
          { effect: 'allow', actions: ['users:read'], resources: ['*'] },
        ]),
      };
      const guard = requireAnyPermission(['admin:access', 'users:read']);
      const req = createMockRequest(
        { id: 'user-1', identityType: 'EXTERNAL_USER', status: 'ACTIVE' },
        mockIamService
      );
      const reply = createMockReply();

      await guard(req as any, reply as any);

      expect(reply.status).not.toHaveBeenCalled();
    });
  });
});
