'use client';

import React, { useState, useId } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CreateLeadActivityRequestSchema,
  CreateQuoteRequestSchema,
  ConvertLeadRequestSchema,
  UpdateLeadRequestSchema,
  type LeadStatus,
  type LeadSource,
  type CreateLeadActivityRequest,
  type CreateQuoteRequest,
  type ConvertLeadRequest,
} from '@packages/validation';
import { toast } from 'sonner';
import {
  Plus,
  LayoutGrid,
  List,
  Search,
  RotateCcw,
  Phone,
  Mail,
  UserCheck,
  Clock,
} from 'lucide-react';
import { crmApi, crmFollowUpDate, quoteDefaultDate } from '@/lib/crm-api';
import {
  LEAD_STATUSES,
  LEAD_SOURCES,
  filterLeads,
  groupLeadsByStatus,
  getFollowUpUrgency,
} from '@/lib/crm-filter';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime, formatMoney } from '@/lib/format';
import { clubToday, memberFormSchema } from '@/lib/member-form';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatTile } from '@/components/club/stat-tile';
import { StatusBadge } from '@/components/club/status-badge';
import { PlanPicker } from '@/components/club/plan-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';

const quickAddSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    phone: z.string().trim().optional(),
    email: z.string().trim().optional(),
    source: z.enum(['WALK_IN', 'PHONE', 'REFERRAL']),
    interestedPlanId: z.string().optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Boolean(v.phone?.trim()) || Boolean(v.email?.trim()), {
    message: 'Provide a phone or an email',
    path: ['phone'],
  });

type QuickAddFormValues = z.infer<typeof quickAddSchema>;

const statuses: LeadStatus[] = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'];

export default function CrmPage() {
  const { user, hasPermission } = useAuth();
  const read = hasPermission('crm:read');
  const manage = hasPermission('crm:manage');
  const client = useQueryClient();

  // Layout & View State
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [statusFilter, setStatusFilter] = useState<LeadStatus>('NEW');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | LeadSource>('ALL');
  const [dueToday, setDueToday] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  // Modals & Selected Lead
  const [selected, setSelected] = useState<string | null>(null);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [memberLink, setMemberLink] = useState<string | null>(null);

  const searchInputId = useId();
  const sourceSelectId = useId();

  // Data Queries
  const summary = useQuery({
    queryKey: ['crm', 'summary'],
    queryFn: crmApi.summary,
    enabled: read,
  });

  // Query leads
  const list = useQuery({
    queryKey: [
      'crm',
      'list',
      viewMode === 'list' ? statusFilter : undefined,
      sourceFilter !== 'ALL' ? sourceFilter : undefined,
      dueToday,
      searchQuery,
      viewMode === 'board' ? 1 : page,
      viewMode === 'board' ? 100 : 20,
    ],
    queryFn: () =>
      crmApi.list({
        status: viewMode === 'list' ? statusFilter : undefined,
        source: sourceFilter !== 'ALL' ? sourceFilter : undefined,
        dueToday: String(dueToday) as 'true' | 'false',
        q: searchQuery.trim() || undefined,
        page: viewMode === 'board' ? 1 : page,
        limit: viewMode === 'board' ? 100 : 20,
      }),
    enabled: read,
  });

  const detail = useQuery({
    queryKey: ['crm', 'detail', selected],
    queryFn: () => crmApi.detail(selected!),
    enabled: read && Boolean(selected),
  });

  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: api.plans.list,
    enabled: manage,
  });

  // Mutations
  const mutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['crm'] });
      void client.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (error) => toast.error(error.message),
  });

  // Forms
  const noteForm = useForm<CreateLeadActivityRequest>({
    resolver: zodResolver(CreateLeadActivityRequestSchema),
    defaultValues: { type: 'NOTE', body: '' },
  });

  const quoteForm = useForm<CreateQuoteRequest>({
    resolver: zodResolver(CreateQuoteRequestSchema),
    defaultValues: { planId: '', validUntil: quoteDefaultDate() },
  });

  const convertForm = useForm<ConvertLeadRequest>({
    resolver: zodResolver(ConvertLeadRequestSchema),
    defaultValues: { planId: '', paymentMethod: 'CASH' },
  });

  const quickAddForm = useForm<QuickAddFormValues>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      source: 'WALK_IN',
      interestedPlanId: '',
      message: '',
    },
  });

  if (!user) return null;

  async function update(data: unknown) {
    const parsed = UpdateLeadRequestSchema.safeParse(data);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    await mutation.mutateAsync(() => crmApi.update(selected!, parsed.data)).catch(() => {});
  }

  const allLeads = list.data?.data ?? [];
  const filteredLeadsList = filterLeads(allLeads, {
    q: searchQuery,
    source: sourceFilter,
    dueTodayOnly: dueToday,
  });
  const groupedLeads = groupLeadsByStatus(filteredLeadsList);

  const openLeadDetail = (leadId: string) => {
    mutation.reset();
    setSelected(leadId);
    setMemberLink(null);
    setLostReason('');
    setConvertOpen(false);
    noteForm.reset({ type: 'NOTE', body: '' });
    quoteForm.reset({ planId: '', validUntil: quoteDefaultDate() });
    convertForm.reset({ planId: '', paymentMethod: 'CASH' });
  };

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Lead pipeline"
          description="Follow up enquiries, track interest, create quotes, and convert leads into members."
        />
        {manage && (
          <div className="flex items-center gap-2">
            <Button
              className="gap-1.5"
              onClick={() => {
                quickAddForm.reset({
                  name: '',
                  phone: '',
                  email: '',
                  source: 'WALK_IN',
                  interestedPlanId: '',
                  message: '',
                });
                setCreateLeadOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Lead
            </Button>
          </div>
        )}
      </div>

      {!read ? (
        <EmptyState
          title="Leads are unavailable"
          description="Ask the owner or front desk manager for CRM access."
        />
      ) : (
        <>
          {/* STAT TILES */}
          {summary.error ? (
            <PageError
              error={summary.error}
              onRetry={() => {
                void summary.refetch();
              }}
            />
          ) : summary.data ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="New leads" value={summary.data.byStatus.NEW} />
              <StatTile label="Due today" value={summary.data.dueToday} />
              <StatTile label="Overdue" value={summary.data.overdue} />
            </div>
          ) : (
            <Skeleton className="h-24 rounded-xl" />
          )}

          {/* FILTER & VIEW CONTROL BAR */}
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Search & Source filter */}
              <div className="flex flex-1 flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id={searchInputId}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search by name, phone, or email…"
                    className="pl-9 pr-8"
                    aria-label="Search leads"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Label htmlFor={sourceSelectId} className="sr-only">
                    Filter by Source
                  </Label>
                  <select
                    id={sourceSelectId}
                    value={sourceFilter}
                    onChange={(e) => {
                      setSourceFilter(e.target.value as 'ALL' | LeadSource);
                      setPage(1);
                    }}
                    className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {LEAD_SOURCES.map((src) => (
                      <option key={src.key} value={src.key}>
                        {src.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 border-l pl-3">
                  <Switch
                    id="due-today"
                    checked={dueToday}
                    onCheckedChange={(value) => {
                      setDueToday(value);
                      setPage(1);
                    }}
                  />
                  <Label htmlFor="due-today" className="text-xs font-medium cursor-pointer">
                    Follow up today
                  </Label>
                </div>
              </div>

              {/* View Switcher */}
              <div className="flex items-center gap-2 self-end lg:self-auto">
                <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('board')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'board'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    aria-label="Kanban board view"
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                    <span>Board</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'list'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    aria-label="Table list view"
                  >
                    <List className="h-4 w-4" aria-hidden="true" />
                    <span>List</span>
                  </button>
                </div>
              </div>
            </div>

            {/* List View Status Tabs */}
            {viewMode === 'list' && (
              <div className="pt-2 border-t">
                <Tabs
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value as LeadStatus);
                    setPage(1);
                  }}
                >
                  <TabsList className="h-8">
                    {statuses.map((val) => (
                      <TabsTrigger key={val} value={val} className="text-xs capitalize">
                        {val.toLowerCase()}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
          </div>

          {/* MAIN VIEW CONTENT */}
          {list.error ? (
            <PageError
              error={list.error}
              onRetry={() => {
                void list.refetch();
              }}
            />
          ) : list.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-80 rounded-xl" />
              ))}
            </div>
          ) : list.data?.data.length === 0 ? (
            <EmptyState
              title="No leads in this view"
              description="Try adjusting your search query, another status or clearing the follow-up filter."
            />
          ) : viewMode === 'board' ? (
            /* KANBAN BOARD VIEW */
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 overflow-x-auto pb-4"
              aria-label="Leads Kanban Board"
            >
              {LEAD_STATUSES.map((column) => {
                const columnLeads = groupedLeads[column.key] ?? [];
                return (
                  <div
                    key={column.key}
                    className="flex flex-col rounded-xl border bg-muted/30 p-3 min-w-[230px]"
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-foreground uppercase tracking-wider">
                          {column.label}
                        </span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono">
                          {columnLeads.length}
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                      {columnLeads.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          No {column.label.toLowerCase()} leads
                        </div>
                      ) : (
                        columnLeads.map((lead) => {
                          const urgency = getFollowUpUrgency(lead.nextFollowUpAt, lead.status);
                          return (
                            <button
                              key={lead.id}
                              type="button"
                              onClick={() => openLeadDetail(lead.id)}
                              className="group w-full rounded-lg border bg-card p-3 text-left shadow-xs transition-all hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <div className="flex items-start justify-between gap-1">
                                <p className="font-semibold text-sm group-hover:text-primary transition-colors">
                                  {lead.name}
                                </p>
                                <span className="text-[10px] uppercase font-mono text-muted-foreground shrink-0">
                                  {lead.source.replaceAll('_', ' ')}
                                </span>
                              </div>

                              {(lead.phone || lead.email) && (
                                <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                                  {lead.phone && (
                                    <div className="flex items-center gap-1.5 truncate">
                                      <Phone className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                                      <span className="truncate">{lead.phone}</span>
                                    </div>
                                  )}
                                  {lead.email && (
                                    <div className="flex items-center gap-1.5 truncate">
                                      <Mail className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                                      <span className="truncate">{lead.email}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {lead.interestedPlan && (
                                <div className="mt-2">
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] font-normal py-0"
                                  >
                                    {lead.interestedPlan.name}
                                  </Badge>
                                </div>
                              )}

                              <div className="mt-2.5 flex items-center justify-between border-t pt-2 text-[11px]">
                                {lead.nextFollowUpAt && !['WON', 'LOST'].includes(lead.status) ? (
                                  <span
                                    className={`flex items-center gap-1 ${
                                      urgency === 'overdue'
                                        ? 'text-destructive font-medium'
                                        : urgency === 'today'
                                        ? 'text-warning font-medium'
                                        : 'text-muted-foreground'
                                    }`}
                                  >
                                    <Clock className="h-4 w-4" aria-hidden="true" />
                                    {formatDateTime(lead.nextFollowUpAt)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {lead.quoteCount > 0
                                      ? `${lead.quoteCount} ${
                                          lead.quoteCount === 1 ? 'quote' : 'quotes'
                                        }`
                                      : 'No follow-up'}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* TABLE LIST VIEW */
            <div className="space-y-4">
              <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['Name', 'Phone', 'Source', 'Plan interest', 'Next follow-up', 'Status'].map(
                        (label) => (
                          <TableHead key={label}>{label}</TableHead>
                        )
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data?.data.map((lead) => {
                      const isOverdue =
                        lead.nextFollowUpAt &&
                        Date.parse(lead.nextFollowUpAt) < Date.now() &&
                        !['WON', 'LOST'].includes(lead.status);

                      return (
                        <TableRow key={lead.id} className="hover:bg-muted/50">
                          <TableCell>
                            <Button
                              variant="link"
                              className="p-0 font-semibold text-primary hover:underline"
                              onClick={() => openLeadDetail(lead.id)}
                            >
                              {lead.name}
                            </Button>
                          </TableCell>
                          <TableCell>{lead.phone ?? 'Not provided'}</TableCell>
                          <TableCell>
                            {lead.source.toLowerCase().replaceAll('_', ' ')}
                          </TableCell>
                          <TableCell>
                            {lead.interestedPlan?.name ?? 'Not chosen'}
                          </TableCell>
                          <TableCell
                            className={isOverdue ? 'text-destructive font-medium' : undefined}
                          >
                            {lead.nextFollowUpAt
                              ? formatDateTime(lead.nextFollowUpAt)
                              : 'Not scheduled'}
                          </TableCell>
                          <TableCell>
                            <StatusBadge kind="lead" value={lead.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing page {page}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!list.data?.meta.hasPrevPage}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!list.data?.meta.hasNextPage}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* QUICK ADD LEAD DIALOG */}
      <Dialog open={createLeadOpen} onOpenChange={setCreateLeadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
              Add New Lead
            </DialogTitle>
            <DialogDescription>
              Record a walk-in, phone enquiry, or referral in the pipeline.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4 pt-2"
            onSubmit={quickAddForm.handleSubmit(async (data) => {
              try {
                const created = (await mutation.mutateAsync(() =>
                  crmApi.create({
                    name: data.name,
                    phone: data.phone?.trim() ? data.phone.trim() : undefined,
                    email: data.email?.trim() ? data.email.trim() : undefined,
                    source: data.source,
                    interestedPlanId: data.interestedPlanId ? data.interestedPlanId : undefined,
                    message: data.message?.trim() ? data.message.trim() : undefined,
                  })
                )) as { name: string };
                toast.success(`Lead "${created.name}" created`);
                setCreateLeadOpen(false);
              } catch {
                /* Error surfaced via mutation toast */
              }
            })}
          >
            <fieldset disabled={mutation.isPending} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="lead-name">Full Name</Label>
                <Input
                  id="lead-name"
                  placeholder="e.g. Vikram Singhania"
                  {...quickAddForm.register('name')}
                />
                {quickAddForm.formState.errors.name && (
                  <p role="alert" className="text-xs text-destructive">
                    {quickAddForm.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="lead-phone">Phone Number</Label>
                  <Input
                    id="lead-phone"
                    type="tel"
                    placeholder="9876543210"
                    {...quickAddForm.register('phone')}
                  />
                  {quickAddForm.formState.errors.phone && (
                    <p role="alert" className="text-xs text-destructive">
                      {quickAddForm.formState.errors.phone.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="lead-email">Email Address</Label>
                  <Input
                    id="lead-email"
                    type="email"
                    placeholder="vikram@example.com"
                    {...quickAddForm.register('email')}
                  />
                  {quickAddForm.formState.errors.email && (
                    <p role="alert" className="text-xs text-destructive">
                      {quickAddForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="lead-source">Source</Label>
                <select
                  id="lead-source"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  {...quickAddForm.register('source')}
                >
                  <option value="WALK_IN">Walk-in</option>
                  <option value="PHONE">Phone Enquiry</option>
                  <option value="REFERRAL">Referral</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="lead-plan">Interested Plan (Optional)</Label>
                <select
                  id="lead-plan"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  {...quickAddForm.register('interestedPlanId')}
                >
                  <option value="">No specific plan yet</option>
                  {plans.data?.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="lead-message">Notes / Enquiry Message</Label>
                <Input
                  id="lead-message"
                  placeholder="e.g. Looking for badminton coaching and weekend court access"
                  {...quickAddForm.register('message')}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateLeadOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Adding Lead…' : 'Save Lead'}
                </Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>

      {/* LEAD DETAIL & ACTIONS DIALOG */}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setConvertOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-xl">
                {detail.data?.lead.name ?? 'Lead details'}
              </DialogTitle>
              {detail.data?.lead.status && (
                <StatusBadge kind="lead" value={detail.data.lead.status} />
              )}
            </div>
            <DialogDescription>
              Contact details, follow-up history, quotes and membership conversion.
            </DialogDescription>
          </DialogHeader>

          {detail.error ? (
            <PageError
              error={detail.error}
              onRetry={() => {
                void detail.refetch();
              }}
            />
          ) : detail.isPending ? (
            <Skeleton className="h-40" />
          ) : (
            detail.data && (
              <div className="space-y-6 pt-2">
                {/* Contact Overview */}
                <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Phone</dt>
                      <dd className="font-medium">{detail.data.lead.phone ?? 'Not provided'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd className="font-medium">{detail.data.lead.email ?? 'Not provided'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Source</dt>
                      <dd className="font-medium uppercase text-xs">
                        {detail.data.lead.source.replaceAll('_', ' ')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Interested Plan</dt>
                      <dd className="font-medium">
                        {detail.data.lead.interestedPlan?.name ?? 'Not chosen'}
                      </dd>
                    </div>
                  </dl>

                  {detail.data.lead.message && (
                    <div className="border-t pt-2 text-xs">
                      <span className="text-muted-foreground font-medium">Message: </span>
                      <span>{detail.data.lead.message}</span>
                    </div>
                  )}
                </div>

                {mutation.error && <PageError error={mutation.error} />}
                {memberLink && (
                  <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
                    <p className="font-medium text-success">
                      Converted successfully!
                    </p>
                    <Link className="underline font-semibold" href={memberLink}>
                      View member profile →
                    </Link>
                  </div>
                )}

                {/* Management Controls */}
                {manage && detail.data.lead.status !== 'WON' && (
                  <fieldset disabled={mutation.isPending} className="space-y-4">
                    {/* Status & Next Follow-Up */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="lead-status">Status</Label>
                        <select
                          id="lead-status"
                          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={detail.data.lead.status}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === 'LOST') {
                              void update({ status: value, lostReason });
                            } else {
                              void update({ status: value });
                            }
                          }}
                        >
                          {statuses
                            .filter((value) => value !== 'WON')
                            .map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="follow-up">Next follow-up</Label>
                        <Input
                          id="follow-up"
                          type="date"
                          value={crmFollowUpDate(detail.data.lead.nextFollowUpAt)}
                          onChange={(event) => {
                            void update({
                              nextFollowUpAt: event.target.value
                                ? new Date(`${event.target.value}T09:00:00+05:30`).toISOString()
                                : null,
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="lost-reason">Reason if lost</Label>
                      <Input
                        id="lost-reason"
                        value={lostReason}
                        placeholder="e.g. Moved away, price too high"
                        onChange={(event) => setLostReason(event.target.value)}
                      />
                    </div>

                    {/* Add Activity / Note */}
                    <form
                      className="space-y-2 rounded-xl border bg-card p-3"
                      onSubmit={noteForm.handleSubmit(async (data) => {
                        await mutation
                          .mutateAsync(() => crmApi.note(selected!, data))
                          .then(() => noteForm.reset())
                          .catch(() => {});
                      })}
                    >
                      <Label htmlFor="lead-note" className="text-xs font-semibold">
                        Add Activity Note
                      </Label>
                      <Input
                        id="lead-note"
                        placeholder="Log call summary, visit notes, or query…"
                        {...noteForm.register('body')}
                      />
                      {noteForm.formState.errors.body && (
                        <p role="alert" className="text-xs text-destructive">
                          {noteForm.formState.errors.body.message}
                        </p>
                      )}
                      <div className="flex justify-end">
                        <Button type="submit" variant="outline" size="sm">
                          Save note
                        </Button>
                      </div>
                    </form>

                    {/* Create Quote Section */}
                    <form
                      className="space-y-3 rounded-xl border bg-card p-4"
                      onSubmit={quoteForm.handleSubmit(async (data) => {
                        await mutation
                          .mutateAsync(() => crmApi.quote(selected!, data))
                          .catch(() => {});
                      })}
                    >
                      <h3 className="font-semibold text-sm">Create Membership Quote</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="quote-plan">Plan</Label>
                          <select
                            id="quote-plan"
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                            {...quoteForm.register('planId')}
                          >
                            <option value="">Choose a plan</option>
                            {plans.data?.map((plan) => (
                              <option key={plan.id} value={plan.id}>
                                {plan.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="quote-amount">Amount (paise)</Label>
                          <Input
                            id="quote-amount"
                            type="number"
                            min="0"
                            placeholder="Leave empty for plan default"
                            {...quoteForm.register('amountPaise', {
                              setValueAs: (value) => (value === '' ? undefined : Number(value)),
                            })}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="quote-valid">Valid until</Label>
                        <Input id="quote-valid" type="date" {...quoteForm.register('validUntil')} />
                      </div>

                      {Object.values(quoteForm.formState.errors).map((error, i) => (
                        <p role="alert" className="text-xs text-destructive" key={i}>
                          {error.message}
                        </p>
                      ))}

                      <Button variant="outline" type="submit" size="sm">
                        Create quote
                      </Button>
                    </form>

                    {/* Convert to Member Action */}
                    <div className="pt-2">
                      <Button
                        className="w-full gap-2 font-semibold"
                        onClick={() => {
                          convertForm.reset({
                            planId: detail.data?.lead.interestedPlan?.id ?? '',
                            paymentMethod: 'CASH',
                          });
                          setConvertOpen(true);
                        }}
                      >
                        <UserCheck className="h-4 w-4" aria-hidden="true" />
                        Convert to member
                      </Button>
                    </div>
                  </fieldset>
                )}

                {/* Quotes List */}
                {detail.data.quotes.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Quotes
                    </h4>
                    <ul className="space-y-2">
                      {detail.data.quotes.map((quote) => (
                        <li
                          key={quote.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                        >
                          <div>
                            <p className="font-medium">
                              {quote.plan.name} · {formatMoney(quote.amountPaise)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Status: <span className="font-semibold">{quote.status.toLowerCase()}</span> · Valid until {quote.validUntil}
                            </p>
                          </div>
                          {manage &&
                            detail.data.lead.status !== 'WON' &&
                            quote.status === 'DRAFT' &&
                            quote.validUntil >= clubToday() && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={mutation.isPending}
                                onClick={() =>
                                  mutation.mutate(() => crmApi.sendQuote(quote.id))
                                }
                              >
                                Send quote
                              </Button>
                            )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Activities Timeline */}
                <div className="space-y-2 border-t pt-4">
                  <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Activity Timeline
                  </h4>
                  {detail.data.activities.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No activities recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.data.activities.map((activity) => (
                        <li
                          key={activity.id}
                          className="rounded-lg border bg-card p-2.5 text-xs space-y-1"
                        >
                          <p className="font-medium text-foreground">{activity.body}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatDateTime(activity.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* CONVERT TO MEMBER DIALOG */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to member</DialogTitle>
            <DialogDescription>
              Choose membership plan and record initial registration payment.
            </DialogDescription>
          </DialogHeader>

          {plans.error && <PageError error={plans.error} />}
          {mutation.error && <PageError error={mutation.error} />}

          <form
            className="space-y-4"
            onSubmit={convertForm.handleSubmit(async (data) => {
              const validMember = memberFormSchema(plans.data ?? []).safeParse({
                fullName: detail.data?.lead.name ?? '',
                phone: data.phone ?? detail.data?.lead.phone ?? '',
                planId: data.planId,
                paymentMethod: data.paymentMethod,
                dateOfBirth: data.dateOfBirth,
              });

              if (!validMember.success) {
                for (const issue of validMember.error.issues) {
                  const field = issue.path[0];
                  if (field === 'phone' || field === 'dateOfBirth' || field === 'planId') {
                    convertForm.setError(field as 'phone' | 'dateOfBirth' | 'planId', {
                      message: issue.message,
                    });
                  }
                }
                return;
              }

              try {
                const result = (await mutation.mutateAsync(() =>
                  crmApi.convert(selected!, data)
                )) as Awaited<ReturnType<typeof crmApi.convert>>;

                toast.success(
                  `${result.member.fullName} is now member ${result.member.memberCode}`
                );
                setMemberLink(`/members/${result.member.id}`);
                setConvertOpen(false);
              } catch {
                /* Mutation surfaces the server error. */
              }
            })}
          >
            <fieldset disabled={mutation.isPending} className="space-y-4">
              <PlanPicker
                plans={plans.data ?? []}
                value={convertForm.watch('planId')}
                onChange={(value) => convertForm.setValue('planId', value)}
                disabled={mutation.isPending}
              />

              <div className="space-y-1">
                <Label htmlFor="convert-payment">Payment method</Label>
                <select
                  id="convert-payment"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  {...convertForm.register('paymentMethod')}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="UPI">UPI</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="convert-phone">Phone (if missing)</Label>
                <Input
                  id="convert-phone"
                  type="tel"
                  {...convertForm.register('phone', {
                    setValueAs: (value) => value || undefined,
                  })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="convert-dob">Date of birth (Junior)</Label>
                <Input
                  id="convert-dob"
                  type="date"
                  {...convertForm.register('dateOfBirth', {
                    setValueAs: (value) => value || undefined,
                  })}
                />
              </div>

              {Object.values(convertForm.formState.errors).map((error, i) => (
                <p key={i} role="alert" className="text-xs text-destructive">
                  {error.message}
                </p>
              ))}

              <Button type="submit" disabled={mutation.isPending} className="w-full">
                {mutation.isPending ? 'Registering…' : 'Confirm conversion'}
              </Button>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
