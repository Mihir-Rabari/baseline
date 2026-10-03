import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useEnquiry() {
  return useMutation({ mutationFn: api.public.createEnquiry });
}
