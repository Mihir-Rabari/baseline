'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileAvatarApi, profileAvatarUrl, type ProfileAvatarMetadata } from '@/lib/profile-avatar';

export const profileAvatarKey = (userId: string | undefined) => ['profile', 'avatar', userId] as const;

export function useProfileAvatar(userId: string | undefined, enabled = true) {
  const client = useQueryClient();
  const queryKey = profileAvatarKey(userId);
  const query = useQuery({ queryKey, queryFn: profileAvatarApi.get, enabled: Boolean(userId) && enabled, staleTime: 60_000, retry: false });
  const upload = useMutation({ mutationFn: profileAvatarApi.upload,
    onSuccess: (data) => { client.setQueryData<ProfileAvatarMetadata>(queryKey, data); },
  });
  const remove = useMutation({ mutationFn: profileAvatarApi.remove,
    onSuccess: () => { client.setQueryData<ProfileAvatarMetadata>(queryKey, { version: null }); },
  });
  return { ...query, upload, remove, src: enabled && userId && query.data?.version ? profileAvatarUrl(userId, query.data.version) : undefined };
}
