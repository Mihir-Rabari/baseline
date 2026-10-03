import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useCreateMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.members.create, onSuccess: () => client.invalidateQueries({ queryKey: ['members'] }) });
}
