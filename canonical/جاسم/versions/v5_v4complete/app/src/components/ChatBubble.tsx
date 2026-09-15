interface ChatBubbleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function ChatBubble({ isOpen, onToggle }: ChatBubbleProps) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'fixed',
        bottom: '80px',
        left: '16px',
        width: '72px',
        height: '72px',
        borderRadius: '50%',
        border: '1px solid rgba(0, 212, 255, 0.3)',
        background: isOpen
          ? 'rgba(0, 212, 255, 0.25)'
          : 'rgba(0, 212, 255, 0.08)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: isOpen
          ? '0 0 30px rgba(0, 212, 255, 0.5), inset 0 0 20px rgba(0, 212, 255, 0.1)'
          : '0 0 20px rgba(0, 212, 255, 0.2), inset 0 0 15px rgba(0, 212, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 40,
        transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        animation: 'snapPulse 3s ease-in-out infinite',
        color: '#00d4ff',
        fontSize: '24px',
      }}
      aria-label="Toggle chat"
    >
      <span style={{ fontSize: '26px', lineHeight: 1 }}>💬</span>
      <span
        style={{
          fontSize: '9px',
          fontWeight: 600,
          marginTop: '2px',
          color: isOpen ? '#00d4ff' : 'rgba(0, 212, 255, 0.7)',
        }}
      >
        جاسم
      </span>
    </button>
  );
}
