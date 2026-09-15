interface Particle {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  size: number;
  duration: number;
}

interface PopParticlesProps {
  particles: Particle[];
}

export default function PopParticles({ particles }: PopParticlesProps) {
  return (
    <>
      {particles.map((p) => (
        <div
          key={p.id}
          className="pop-particle"
          style={{
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            background: `radial-gradient(circle, ${p.color}ff, ${p.color}80, transparent)`,
            boxShadow: `0 0 ${p.size * 2}px ${p.color}80, 0 0 ${p.size * 4}px ${p.color}40, inset 0 0 ${p.size}px rgba(255,255,255,0.5)`,
            ['--tx' as string]: `${p.tx}px`,
            ['--ty' as string]: `${p.ty}px`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </>
  );
}
