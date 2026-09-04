import {
  GiPrayerBeads,
  GiHealing,
  GiTrident,
  GiFlangedMace,
  GiBowArrow,
  GiLion,
  GiMeditation,
  GiHearts,
  GiYinYang,
  GiLotusFlower
} from 'react-icons/gi';
import {
  TbWind,
  TbSparkles,
  TbBox,
  TbTrendingUp,
  TbCurrencyRupee
} from 'react-icons/tb';
import type { FlowType, PracticeCard } from './types';

export const preferences = [
  { id: 'meditation' as FlowType, label: 'Meditation', description: 'Saans, stillness aur mindful guidance.', icon: GiLotusFlower },
  { id: 'mantra' as FlowType, label: 'Mantra Chant', description: 'Apna mantra chunein aur seedha jaap shuru karein.', icon: GiPrayerBeads },
  { id: 'samadhan' as FlowType, label: 'Problem Ka Samadhan', description: 'Dil ki baat chunein, mantra-based samadhan paayein.', icon: GiHealing }
];

export const practices: Record<FlowType, PracticeCard[]> = {
  mantra: [
    { id: 'shivaya', label: 'Om Namah Shivaya', description: 'Mann ko shaant aur andar se sthir banaye.', icon: GiTrident, theme: { dark: '#561712', accent: '#F4541A' } },
    { id: 'hanumate', label: 'Om Shri Hanumate Namah', description: 'Himmat, focus aur confidence badhaye.', icon: GiFlangedMace, theme: { dark: '#6C210D', accent: '#E76C16' } },
    { id: 'ram', label: 'Jai Shri Ram', description: 'Dharma, discipline aur positive energy jagaye.', icon: GiBowArrow, theme: { dark: '#71340C', accent: '#F39418' } },
    { id: 'durga', label: 'Jai Maa Durga', description: 'Shakti de aur negativity se raksha kare.', icon: GiLion, theme: { dark: '#64112A', accent: '#D63B37' } }
  ],
  meditation: [
    { id: 'vagus', label: '4-7-8 Breathing', description: '4 seconds inhale, 7 hold, 8 exhale — nervous system ko turant calm karein.', icon: TbWind, theme: { dark: '#173D46', accent: '#36A6A0' }, youtubeId: 'mBISVBg0zKw' },
    { id: 'guided', label: 'Guided Meditation', description: 'Ek gentle guide ke saath step-by-step breathe karein.', icon: GiMeditation, theme: { dark: '#3D235C', accent: '#8F5CC4' }, youtubeId: 'FHsO0xGcfkA' },
    { id: 'affirmation', label: 'Manifestation Meditation', description: 'Apni ichchaon aur intentions par focus karke manifest karein.', icon: TbSparkles, theme: { dark: '#712748', accent: '#D56588' }, youtubeId: '3Q9McpoTwJE' },
    { id: 'box', label: 'Box Breathing', description: 'Growing box ko follow karke breathing balance karein.', icon: TbBox, theme: { dark: '#173967', accent: '#488BD5' }, youtubeId: 'nj0jDKzxLwo' }
  ],
  samadhan: [
    { id: 'love', label: 'Love', description: 'Rishton aur emotions mein clarity ke liye.', icon: GiHearts, mantra: 'Om Namah Shivaya', theme: { dark: '#711F39', accent: '#DF5571' } },
    { id: 'career', label: 'Career', description: 'Direction, focus aur growth ke liye.', icon: TbTrendingUp, mantra: 'Om Shri Hanumate Namah', theme: { dark: '#263D46', accent: '#519B7D' } },
    { id: 'money', label: 'Money', description: 'Abundance aur disciplined action ke liye.', icon: TbCurrencyRupee, mantra: 'Jai Maa Durga', theme: { dark: '#5E3A12', accent: '#D39B2C' } },
    { id: 'general', label: 'General', description: 'Jab mann par bojh ho aur raasta saaf na dikhe.', icon: GiYinYang, mantra: 'Jai Shri Ram', theme: { dark: '#45315F', accent: '#8E6DBA' } }
  ]
};
