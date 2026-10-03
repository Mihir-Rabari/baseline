'use client';

import React, { useState } from 'react';
import {
  useIamGroups,
  useIamPolicies,
  useCreateGroup,
  useDeleteGroup,
} from '@/hooks/use-iam';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

export default function GroupsManagementPage() {
  const { data: groups, isLoading, refetch } = useIamGroups();
  const { data: policies } = useIamPolicies();
  const createGroupMutation = useCreateGroup();
  const deleteGroupMutation = useDeleteGroup();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await createGroupMutation.mutateAsync({
        name,
        description: description || undefined,
        policyIds: selectedPolicies,
      });
      toast.success(`Group '${name}' created successfully`);
      setName('');
      setDescription('');
      setSelectedPolicies([]);
      setShowCreate(false);
      refetch();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create group');
      setError(msg);
      toast.error('Creation failed', { description: msg });
    }
  };

  const handleDelete = async (groupId: string, groupName: string) => {
    if (confirm(`Are you sure you want to delete group '${groupName}'?`)) {
      try {
        await deleteGroupMutation.mutateAsync(groupId);
        toast.success(`Group '${groupName}' deleted`);
        refetch();
      } catch {
        toast.error('Failed to delete group');
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
          <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Groups let a set of users share the same policies.
          </p>
        </div>

        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {showCreate ? 'Cancel' : 'Create Group'}
        </Button>
      </div>

      {/* Create Group Form */}
      {showCreate && (
        <Card className="border-primary/20 shadow-md">
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle className="text-base">Create New IAM Group</CardTitle>
              <CardDescription>Define group name and attach initial policies</CardDescription>
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
                  <Label htmlFor="group-name">Group Name</Label>
                  <Input
                    id="group-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Engineering"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-desc">Description</Label>
                  <Input
                    id="group-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Group purpose or department"
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
                  Create Group
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* Groups List */}
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading groups...</div>
        ) : !groups || groups.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No groups configured.</div>
        ) : (
          groups.map((group) => (
            <Card key={group.id} className="border-border shadow-sm">
              <CardHeader className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    {group.isSystem && (
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        System Default
                      </Badge>
                    )}
                  </div>
                  {!group.isSystem && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(group.id, group.name)}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  )}
                </div>
                {group.description && (
                  <CardDescription className="text-xs mt-1">{group.description}</CardDescription>
                )}
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
