import type { BubbleType } from './BubbleTypes';
import type { BubbleExpression } from './BubbleExpression';

export interface Bubble {
  id: string;
  type: BubbleType;
  expression: BubbleExpression | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetRadius: number;
  opacity: number;
  scale: number;
  rotation: number;
  zIndex: number;
  isExpanded: boolean;
  isHovered: boolean;
  isSelected: boolean;
  energy: number;
  pulsePhase: number;
  connections: string[];
  metadata: BubbleMetadata;
}

export interface BubbleMetadata {
  platformId?: string;
  agentId?: string;
  listingId?: string;
  category?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BubbleEngineState {
  bubbles: Bubble[];
  selectedBubbleId: string | null;
  hoveredBubbleId: string | null;
  canvasWidth: number;
  canvasHeight: number;
  gravity: number;
  wind: number;
  turbulence: number;
  isRunning: boolean;
  fps: number;
}

export function createBubble(
  type: BubbleType,
  x: number,
  y: number,
  expression: BubbleExpression | null = null
): Bubble {
  const sizePx = getBubbleSizePixels(type.size);
  return {
    id: `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    expression,
    x,
    y,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    radius: sizePx / 2,
    targetRadius: sizePx / 2,
    opacity: 0.9,
    scale: 1,
    rotation: 0,
    zIndex: Math.floor(Math.random() * 100),
    isExpanded: false,
    isHovered: false,
    isSelected: false,
    energy: 100,
    pulsePhase: Math.random() * Math.PI * 2,
    connections: [],
    metadata: {
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

export function updateBubblePhysics(bubble: Bubble, state: BubbleEngineState, deltaTime: number): Bubble {
  const dt = deltaTime / 16;
  const physics = bubble.type.physics;

  let vx = bubble.vx;
  let vy = bubble.vy;

  vy -= physics.buoyancy * 0.01 * dt;
  vy += state.gravity * 0.005 * dt;
  vx += state.wind * 0.01 * dt;

  vx += (Math.random() - 0.5) * state.turbulence * 0.1 * dt;
  vy += (Math.random() - 0.5) * state.turbulence * 0.1 * dt;

  vx *= 1 - physics.drag * dt;
  vy *= 1 - physics.drag * dt;

  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > physics.maxVelocity) {
    vx = (vx / speed) * physics.maxVelocity;
    vy = (vy / speed) * physics.maxVelocity;
  }

  let x = bubble.x + vx * dt;
  let y = bubble.y + vy * dt;

  const margin = bubble.radius;
  if (x < margin) { x = margin; vx = Math.abs(vx) * physics.elasticity; }
  if (x > state.canvasWidth - margin) { x = state.canvasWidth - margin; vx = -Math.abs(vx) * physics.elasticity; }
  if (y < margin) { y = margin; vy = Math.abs(vy) * physics.elasticity; }
  if (y > state.canvasHeight - margin) { y = state.canvasHeight - margin; vy = -Math.abs(vy) * physics.elasticity; }

  return {
    ...bubble,
    x,
    y,
    vx,
    vy,
    pulsePhase: bubble.pulsePhase + 0.05 * dt,
    scale: bubble.isHovered ? 1.15 : bubble.isExpanded ? 1.3 : 1 + Math.sin(bubble.pulsePhase) * 0.03,
    opacity: bubble.isHovered ? 1 : 0.85 + Math.sin(bubble.pulsePhase * 0.5) * 0.1,
    energy: Math.max(0, bubble.energy - 0.01 * dt),
  };
}

export function handleBubbleCollision(a: Bubble, b: Bubble): [Bubble, Bubble] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = a.radius + b.radius;

  if (dist < minDist && dist > 0) {
    const overlap = minDist - dist;
    const nx = dx / dist;
    const ny = dy / dist;

    const pushX = nx * overlap * 0.5;
    const pushY = ny * overlap * 0.5;

    const elasticity = (a.type.physics.elasticity + b.type.physics.elasticity) / 2;

    return [
      { ...a, x: a.x - pushX, y: a.y - pushY, vx: a.vx - nx * elasticity, vy: a.vy - ny * elasticity },
      { ...b, x: b.x + pushX, y: b.y + pushY, vx: b.vx + nx * elasticity, vy: b.vy + ny * elasticity },
    ];
  }

  return [a, b];
}

export function expandBubble(bubble: Bubble): Bubble {
  return { ...bubble, isExpanded: true, targetRadius: bubble.radius * 2, zIndex: 1000 };
}

export function collapseBubble(bubble: Bubble): Bubble {
  return { ...bubble, isExpanded: false, targetRadius: getBubbleSizePixels(bubble.type.size) / 2, zIndex: bubble.zIndex };
}

export function selectBubble(bubble: Bubble): Bubble {
  return { ...bubble, isSelected: true };
}

export function deselectBubble(bubble: Bubble): Bubble {
  return { ...bubble, isSelected: false, isExpanded: false };
}

export function connectBubbles(a: Bubble, b: Bubble): [Bubble, Bubble] {
  return [
    { ...a, connections: [...a.connections, b.id] },
    { ...b, connections: [...b.connections, a.id] },
  ];
}

export function disconnectBubbles(a: Bubble, b: Bubble): [Bubble, Bubble] {
  return [
    { ...a, connections: a.connections.filter((id) => id !== b.id) },
    { ...b, connections: b.connections.filter((id) => id !== a.id) },
  ];
}

function getBubbleSizePixels(size: BubbleType['size']): number {
  const sizes = { small: 48, medium: 64, large: 80, xlarge: 96 };
  return sizes[size] ?? 64;
}
