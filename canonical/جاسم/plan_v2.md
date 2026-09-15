# JASIM v4.0 — Living Generative Organism Plan

## Philosophy
JASIM is NOT a static app with pre-built features. JASIM is a **living organism** that:
1. **Hears** user intent (Arabic/English text)
2. **Understands** what domain/platform the user wants
3. **Generates** a unique Platform DNA
4. **Breeds** specialized agents for that platform
5. **Spawns** living bubbles representing those agents
6. **Evolves** the platform as user interacts

## Architecture

### Core Engine (`src/core/living/`)
| Module | Purpose |
|--------|---------|
| `platform-dna.ts` | PlatformDNA — unique gene per platform (colors, personality, features, agentCount) |
| `agent-breeder.ts` | Breeds agents from PlatformDNA + user intent |
| `platform-engine.ts` | Main engine: intent → DNA → Agents → Bubbles |
| `swarm-orchestrator.ts` | Orchestrates agent swarm lifecycle |
| `types.ts` | All living organism types |

### Frontend (`src/components/living/`)
| Component | Purpose |
|-----------|---------|
| `LivingPlatform.tsx` | Renders a generated platform with its DNA |
| `LivingAgentCard.tsx` | Card for a bred agent, animated, interactive |
| `LivingBubble.tsx` | Bubble that represents a living agent |
| `DNAVisualizer.tsx` | Visualizes platform DNA as animated strands |
| `SwarmPanel.tsx` | Shows all living agents in a swarm |

### Integration
- `Home.tsx` becomes the organism's brain
- Chat message triggers the living pipeline
- Everything is generated — nothing is hardcoded
