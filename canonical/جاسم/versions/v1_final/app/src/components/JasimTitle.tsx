export default function JasimTitle() {
  return (
    <div
      style={{
        position: 'fixed',
        top: '6vh',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        textAlign: 'center',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(48px, 10vw, 90px)',
          fontWeight: 800,
          letterSpacing: '2px',
          background: 'linear-gradient(90deg, #00d4ff, #4a9eff, #a855f7, #ec4899, #00d4ff)',
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          animation: 'titleShift 6s ease infinite',
          lineHeight: 1.1,
        }}
      >
        جاسم
      </h1>
      <p
        style={{
          fontSize: 'clamp(14px, 3vw, 20px)',
          fontWeight: 300,
          color: 'rgba(255, 255, 255, 0.85)',
          marginTop: '8px',
          textShadow: '0 0 20px rgba(0, 212, 255, 0.4)',
          letterSpacing: '1px',
        }}
      >
        وكيلك الذكي التوليدي
      </p>
    </div>
  );
}
