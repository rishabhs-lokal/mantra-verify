import type { ComponentType } from 'react';

export type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

export type FlowType = 'mantra' | 'meditation' | 'samadhan';
export type Screen = 'home' | 'preferences' | 'choices' | 'room';

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
}

export interface SessionPayload {
  type: FlowType;
  item_id: string;
  count: number;
}
