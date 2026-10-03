'use client';

import React, { useState } from 'react';
import { useIamPolicies, useCreatePolicy, useDeletePolicy, useIamPolicy } from '@/hooks/use-iam';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, AlertCircle, Eye, X } from 'lucide-react';
import type { PolicyStatement } from '@packages/validation';
import { SUPPORTED_CONDITION_OPERATORS } from '@packages/validation';
import { getErrorMessage } from '@/lib/errors';

export default function PoliciesManagementPage() {
  const { data: policies, isLoading, refetch } = useIamPolicies();
  const createPolicyMutation = useCreatePolicy();
  const deletePolicyMutation = useDeletePolicy();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);

  const { data: selectedPolicyDetail } = useIamPolicy(selectedPolicyId || '');

  // Create form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statements, setStatements] = useState<PolicyStatement[]>([
    { effect: 'allow', actions: ['users:read'], resources: ['*'] },
  ]);
  const [error, setError] = useState<string | null>(null);

  const addStatement = () => {
    setStatements((prev) => [...prev, { effect: 'allow', actions: [''], resources: ['*'] }]);
  };

  const removeStatement = (index: number) => {
    setStatements((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStatementEffect = (index: number, effect: 'allow' | 'deny') => {
    setStatements((prev) =>
      prev.map((s, i) => (i === index ? { ...s, effect } : s))
    );
  };

  const updateStatementActions = (index: number, actionsStr: string) => {
    const actions = actionsStr
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    setStatements((prev) =>
      prev.map((s, i) => (i === index ? { ...s, actions } : s))
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate statements
    for (const stmt of statements) {
      if (!stmt.actions || stmt.actions.length === 0) {
        const msg = 'Every statement must specify at least one action (e.g. users:read or users:*)';
        setError(msg);
        toast.error('Validation error', { description: msg });
        return;
      }
    }

    try {
      await createPolicyMutation.mutateAsync({
        name,
        description: description || undefined,
        statements,
      });
      toast.success(`Policy '${name}' created successfully`);
      setName('');
      setDescription('');
      setStatements([{ effect: 'allow', actions: ['users:read'], resources: ['*'] }]);
      setShowCreate(false);
      refetch();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create policy');
      setError(msg);
      toast.error('Creation failed', { description: msg });
    }
  };

  const handleDelete = async (policyId: string, policyName: string) => {
    if (confirm(`Are you sure you want to delete policy '${policyName}'?`)) {
      try {
        await deletePolicyMutation.mutateAsync(policyId);
        toast.success(`Policy '${policyName}' deleted`);
        refetch();
      } catch {
        toast.error('Failed to delete policy');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A policy is a list of allow and deny statements. Deny always wins.
          </p>
        </div>

        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {showCreate ? 'Cancel' : 'Create Policy'}
        </Button>
      </div>

      {/* Create Policy Form */}
      {showCreate && (
        <Card className="border-primary/20 shadow-md">
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle className="text-base">Create New IAM Policy</CardTitle>
              <CardDescription>
                Define policy statements with explicit Allow or Deny effects
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="policy-name">Policy Name</Label>
                  <Input
                    id="policy-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. ReadOnlyUsersPolicy"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="policy-desc">Description</Label>
                  <Input
                    id="policy-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Policy purpose and scope"
                  />
                </div>
              </div>

              {/* Statements Builder */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label>Policy Statements (Allow / Deny)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addStatement} className="h-7 text-xs">
                    <Plus className="h-3 w-3 mr-1" /> Add Statement
                  </Button>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Conditions are edited via the API. Supported operators:{' '}
                  {SUPPORTED_CONDITION_OPERATORS.map((op, i) => (
                    <React.Fragment key={op}>
                      {i > 0 && ', '}
                      <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">{op}</code>
                    </React.Fragment>
                  ))}
                  .
                </p>

                <div className="space-y-3">
                  {statements.map((stmt, idx) => (
                    <div key={idx} className="p-3 rounded-lg border bg-card/60 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">Statement #{idx + 1}</span>
                        {statements.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeStatement(idx)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <Label className="text-[11px] text-muted-foreground block mb-1">Effect</Label>
                          <select
                            value={stmt.effect}
                            onChange={(e) =>
                              updateStatementEffect(idx, e.target.value as 'allow' | 'deny')
                            }
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-ring outline-none"
                          >
                            <option value="allow">ALLOW</option>
                            <option value="deny">DENY (Overrides Allow)</option>
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <Label className="text-[11px] text-muted-foreground block mb-1">
                            Actions (comma-separated, e.g. <code className="font-mono text-primary">users:read, roles:*</code>)
                          </Label>
                          <Input
                            type="text"
                            required
                            placeholder="e.g. users:read, roles:read, profile:*:self"
                            value={stmt.actions.join(', ')}
                            onChange={(e) => updateStatementActions(idx, e.target.value)}
                            className="font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Create Policy
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* Selected Policy Statement Modal / Drawer */}
      {selectedPolicyDetail && (
        <Card className="border-primary/30 bg-card/80 shadow-md">
          <CardHeader className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span>{selectedPolicyDetail.name}</span>
                  {selectedPolicyDetail.isSystem && (
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">
                      System Default
                    </Badge>
                  )}
                </CardTitle>
                {selectedPolicyDetail.description && (
                  <CardDescription className="text-xs mt-0.5">
                    {selectedPolicyDetail.description}
                  </CardDescription>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPolicyId(null)}
                className="h-7 w-7 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase">
              Statements ({selectedPolicyDetail.statements?.length ?? 0})
            </div>
            <div className="space-y-2">
              {selectedPolicyDetail.statements?.map((stmt, idx) => (
                <div key={idx} className="p-2.5 rounded border bg-background text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={stmt.effect === 'deny' ? 'destructive' : 'default'}
                      className="text-[10px] uppercase font-mono"
                    >
                      {stmt.effect}
                    </Badge>
                    <span className="text-muted-foreground text-[11px]">Resources: {stmt.resources.join(', ')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {stmt.actions.map((act) => (
                      <Badge key={act} variant="secondary" className="font-mono text-[11px] py-0 px-1.5">
                        {act}
                      </Badge>
                    ))}
                  </div>
                  {stmt.conditions && Object.keys(stmt.conditions).length > 0 && (
                    <div className="text-[11px] text-muted-foreground pt-1">
                      Conditions:{' '}
                      <code className="font-mono bg-muted px-1 py-0.5 rounded">{JSON.stringify(stmt.conditions)}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Policies List */}
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading policies...</div>
        ) : !policies || policies.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No policies configured.</div>
        ) : (
          policies.map((policy) => (
            <Card key={policy.id} className="border-border shadow-sm">
              <CardHeader className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{policy.name}</CardTitle>
                    {policy.isSystem && (
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        System Default
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPolicyId(policy.id)}
                      className="h-8 px-2 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      View Statements
                    </Button>
                    {!policy.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(policy.id, policy.name)}
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {policy.description && (
                  <CardDescription className="text-xs mt-1">{policy.description}</CardDescription>
                )}
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
