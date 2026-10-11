import { apiGet, apiPut } from '../api';
import type { UserProfile, AISettings } from '../../_interfaces/api';

export async function getProfile(): Promise<UserProfile> {
  const res = await apiGet<{ success: boolean; profile: UserProfile }>('/profile');
  return res.profile;
}

export async function updateProfile(profile: UserProfile): Promise<{ success: boolean }> {
  return apiPut('/profile', profile);
}

export async function getAISettings(): Promise<AISettings> {
  const res = await apiGet<{ success: boolean; settings: AISettings }>('/profile/ai');
  return res.settings;
}

export async function updateAISettings(settings: Partial<AISettings>): Promise<{ success: boolean }> {
  return apiPut('/profile/ai', settings);
}
