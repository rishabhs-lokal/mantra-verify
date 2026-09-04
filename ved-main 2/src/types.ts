import type { ComponentType } from 'react';

export type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

export type FlowType = 'mantra' | 'meditation' | 'samadhan';
export type Screen = 'preferences' | 'choices' | 'chat' | 'mantraPath' | 'expert' | 'room';

export interface Theme {
  dark: string;
  accent: string;
}

export interface PracticeCard {
  id: string;
  label: string;
  description: string;
  icon: IconComponent;
  theme: Theme;
  mantra?: string;
  /** Only set for samadhan (problem) cards — the intake question asked before the reassurance + path screens. */
  question?: string;
}

export interface SessionPayload {
  type: FlowType;
  item_id: string;
  count: number;
  user_id: string;
}

export interface OfferingStats {
  ok: boolean;
  is_new_user: boolean;
  counts_30d: Record<string, number>;
  recently_used_item_id: string | null;
}
