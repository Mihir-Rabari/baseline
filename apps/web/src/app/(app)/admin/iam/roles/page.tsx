'use client';

import React, { useState } from 'react';
import {
  useIamRoles,
  useIamPolicies,
  useCreateRole,
  useDeleteRole,
} from '@/hooks/use-iam';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

export default function RolesManagementPage() {
  const { data: roles, isLoading, refetch } = useIamRoles();
  const { data: policies } = useIamPolicies();
  const createRoleMutation = useCreateRole();
  const deleteRoleMutation = useDeleteRole();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await createRoleMutation.mutateAsync({
        name,
        description: description || undefined,
        policyIds: selectedPolicies,
      });
      toast.success(`Role '${name}' created successfully`);
      setName('');
      setDescription('');
      setSelectedPolicies([]);
      setShowCreate(false);
      refetch();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create role');
      setError(msg);
      toast.error('Creation failed', { description: msg });
    }
  };

  const handleDelete = async (roleId: string, roleName: string) => {
    if (confirm(`Are you sure you want to delete role '${roleName}'?`)) {
      try {
        await deleteRoleMutation.mutateAsync(roleId);
        toast.success(`Role '${roleName}' deleted`);
        refetch();
      } catch {
        toast.error('Failed to delete role');
      }
    }
  };

  const togglePolicy = (policyId: string) => {
    setSelectedPolicies((prev) =>
      prev.includes(policyId) ? prev.filter((id) => id !== policyId) : [...prev, policyId]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A role bundles policies so you can assign them together.
          </p>
        </div>

        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {showCreate ? 'Cancel' : 'Create Role'}
        </Button>
      </div>

      {/* Create Role Form */}
      {showCreate && (
        <Card className="border-primary/20 shadow-md">
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle className="text-base">Create New IAM Role</CardTitle>
              <CardDescription>Define role name and attach initial policies</CardDescription>
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
                  <Label htmlFor="role-name">Role Name</Label>
                  <Input
                    id="role-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. AUDITOR"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role-desc">Description</Label>
                  <Input
                    id="role-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description of role responsibilities"
                  />
                </div>
              </div>

              {policies && policies.length > 0 && (
                <div className="space-y-2">
                  <Label>Attach Policies</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md bg-muted/20">
                    {policies.map((pol) => (
                      <label
                        key={pol.id}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-muted text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPolicies.includes(pol.id)}
                          onChange={() => togglePolicy(pol.id)}
                          className="rounded border-input text-primary"
                        />
                        <span className="font-medium">{pol.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Create Role
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* Roles List */}
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading roles...</div>
        ) : !roles || roles.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No roles configured.</div>
        ) : (
          roles.map((role) => (
            <Card key={role.id} className="border-border shadow-sm">
              <CardHeader className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    {role.isSystem && (
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        System Default
                      </Badge>
                    )}
                  </div>
                  {!role.isSystem && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(role.id, role.name)}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  )}
                </div>
                {role.description && (
                  <CardDescription className="text-xs mt-1">{role.description}</CardDescription>
                )}
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
