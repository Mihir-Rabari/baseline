'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useIamUsers, useUpdateUserStatus } from '@/hooks/use-iam';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Ban,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { UserStatus } from '@packages/validation';

export default function UsersManagementPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const { data, isLoading, refetch } = useIamUsers({
    page,
    limit: 10,
    search: search || undefined,
    status: statusFilter === 'ALL' ? undefined : (statusFilter as UserStatus),
  });

  const updateStatusMutation = useUpdateUserStatus();

  const handleStatusChange = async (userId: string, newStatus: UserStatus) => {
    try {
      await updateStatusMutation.mutateAsync({ id: userId, data: { status: newStatus } });
      toast.success(`User status updated to ${newStatus}`);
      refetch();
    } catch {
      toast.error('Failed to update user status');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accounts, their permissions, and their status.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by email or name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            <div className="w-full sm:w-48">
              <Select
                value={statusFilter}
                onValueChange={(val: string) => {
                  setStatusFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="DISABLED">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-border shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Loading user accounts...
            </div>
          ) : !data || data.data.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground space-y-2">
              <Users className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p>No user accounts found matching your criteria.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((u) => {
                  const isRoot = u.identityType === 'ROOT';
                  const initials = u.name
                    ? u.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)
                    : u.email.charAt(0).toUpperCase();

                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-foreground">{u.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={isRoot ? 'destructive' : 'outline'}
                          className="text-[10px] uppercase font-mono"
                        >
                          {isRoot ? 'ROOT' : u.identityType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            u.status === 'ACTIVE'
                              ? 'success'
                              : u.status === 'SUSPENDED'
                              ? 'warning'
                              : 'destructive'
                          }
                          className="text-[10px] uppercase font-semibold"
                        >
                          {u.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link href={`/admin/iam/users/${u.id}`}>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Inspect
                            </Button>
                          </Link>

                          {!isRoot && (
                            <>
                              {u.status === 'ACTIVE' ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleStatusChange(u.id, 'SUSPENDED')}
                                  className="h-8 px-2 text-xs text-warning hover:text-warning hover:bg-warning/10"
                                  title="Suspend User"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleStatusChange(u.id, 'ACTIVE')}
                                  className="h-8 px-2 text-xs text-success hover:text-success hover:bg-success/10"
                                  title="Activate User"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </Button>
                              )}

                              {u.status !== 'DISABLED' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleStatusChange(u.id, 'DISABLED')}
                                  className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10"
                                  title="Disable User"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {data && data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <div>
                Showing {(data.meta.page - 1) * data.meta.limit + 1} to{' '}
                {Math.min(data.meta.page * data.meta.limit, data.meta.totalItems)} of{' '}
                {data.meta.totalItems} users
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data.meta.hasPrevPage}
                  onClick={() => setPage((p) => p - 1)}
                  className="h-7 px-2"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2 font-medium">
                  Page {data.meta.page} of {data.meta.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data.meta.hasNextPage}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 px-2"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
