export interface BubbleType {
  id: string;
  name: string;
  icon: string;
  color: string;
  gradient: string;
  size: 'small' | 'medium' | 'large' | 'xlarge';
  shape: 'circle' | 'rounded' | 'hexagon' | 'droplet';
  animation: 'float' | 'pulse' | 'bounce' | 'orbit' | 'drift';
  physics: BubblePhysics;
}

export interface BubblePhysics {
  mass: number;
  buoyancy: number;
  drag: number;
  elasticity: number;
  viscosity: number;
  maxVelocity: number;
  attractionRadius: number;
  repulsionRadius: number;
}

export const BUBBLE_TYPES: BubbleType[] = [
  {
    id: 'product',
    name: 'Product',
    icon: 'Package',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    size: 'medium',
    shape: 'circle',
    animation: 'float',
    physics: { mass: 1, buoyancy: 0.8, drag: 0.05, elasticity: 0.7, viscosity: 0.1, maxVelocity: 2, attractionRadius: 100, repulsionRadius: 30 },
  },
  {
    id: 'service',
    name: 'Service',
    icon: 'Wrench',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    size: 'medium',
    shape: 'rounded',
    animation: 'pulse',
    physics: { mass: 1.2, buoyancy: 0.7, drag: 0.06, elasticity: 0.6, viscosity: 0.12, maxVelocity: 1.8, attractionRadius: 90, repulsionRadius: 35 },
  },
  {
    id: 'job',
    name: 'Job',
    icon: 'Briefcase',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    size: 'medium',
    shape: 'hexagon',
    animation: 'bounce',
    physics: { mass: 0.9, buoyancy: 0.9, drag: 0.04, elasticity: 0.8, viscosity: 0.08, maxVelocity: 2.2, attractionRadius: 110, repulsionRadius: 25 },
  },
  {
    id: 'property',
    name: 'Property',
    icon: 'Home',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    size: 'large',
    shape: 'droplet',
    animation: 'drift',
    physics: { mass: 1.5, buoyancy: 0.6, drag: 0.08, elasticity: 0.5, viscosity: 0.15, maxVelocity: 1.5, attractionRadius: 120, repulsionRadius: 40 },
  },
  {
    id: 'vehicle',
    name: 'Vehicle',
    icon: 'Car',
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    size: 'medium',
    shape: 'circle',
    animation: 'orbit',
    physics: { mass: 1.3, buoyancy: 0.7, drag: 0.07, elasticity: 0.6, viscosity: 0.11, maxVelocity: 1.8, attractionRadius: 95, repulsionRadius: 38 },
  },
  {
    id: 'freelance',
    name: 'Freelance',
    icon: 'User',
    color: '#06b6d4',
    gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    size: 'small',
    shape: 'rounded',
    animation: 'float',
    physics: { mass: 0.7, buoyancy: 1.0, drag: 0.03, elasticity: 0.9, viscosity: 0.06, maxVelocity: 2.5, attractionRadius: 80, repulsionRadius: 20 },
  },
  {
    id: 'event',
    name: 'Event',
    icon: 'Calendar',
    color: '#ec4899',
    gradient: 'linear-gradient(135deg, #ec4899, #db2777)',
    size: 'medium',
    shape: 'hexagon',
    animation: 'pulse',
    physics: { mass: 1.1, buoyancy: 0.75, drag: 0.055, elasticity: 0.65, viscosity: 0.1, maxVelocity: 1.9, attractionRadius: 105, repulsionRadius: 32 },
  },
  {
    id: 'education',
    name: 'Education',
    icon: 'GraduationCap',
    color: '#14b8a6',
    gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)',
    size: 'medium',
    shape: 'circle',
    animation: 'drift',
    physics: { mass: 1, buoyancy: 0.85, drag: 0.045, elasticity: 0.75, viscosity: 0.09, maxVelocity: 2, attractionRadius: 100, repulsionRadius: 28 },
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    icon: 'Heart',
    color: '#f43f5e',
    gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)',
    size: 'large',
    shape: 'droplet',
    animation: 'float',
    physics: { mass: 1.4, buoyancy: 0.65, drag: 0.075, elasticity: 0.55, viscosity: 0.13, maxVelocity: 1.6, attractionRadius: 115, repulsionRadius: 36 },
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: 'Plane',
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    size: 'xlarge',
    shape: 'rounded',
    animation: 'orbit',
    physics: { mass: 1.6, buoyancy: 0.55, drag: 0.09, elasticity: 0.45, viscosity: 0.16, maxVelocity: 1.4, attractionRadius: 130, repulsionRadius: 45 },
  },
];

export function getBubbleTypeById(id: string): BubbleType | undefined {
  return BUBBLE_TYPES.find((b) => b.id === id);
}

export function getBubbleTypesByCategory(category: string): BubbleType[] {
  return BUBBLE_TYPES.filter((b) => b.id.includes(category));
}

export function getBubbleSizePixels(size: BubbleType['size']): number {
  const sizes = { small: 48, medium: 64, large: 80, xlarge: 96 };
  return sizes[size] ?? 64;
}
