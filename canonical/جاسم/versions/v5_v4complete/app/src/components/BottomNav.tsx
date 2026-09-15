import { NavLink } from 'react-router';

const tabs = [
  { path: '/', label: 'الرئيسية', icon: '⌂' },
  { path: '/merchants', label: 'المتاجر', icon: '🏪' },
  { path: '/agents', label: 'الوكلاء', icon: '🤖' },
  { path: '/orders', label: 'الطلبات', icon: '📋' },
  { path: '/account', label: 'حسابي', icon: '👤' },
];

export default function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '64px',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        background: 'rgba(0, 0, 17, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(0, 212, 255, 0.15)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            textDecoration: 'none',
            color: isActive ? '#00d4ff' : 'rgba(255, 255, 255, 0.5)',
            fontSize: '11px',
            fontWeight: isActive ? 600 : 400,
            transition: 'color 0.3s ease',
            flex: 1,
            height: '100%',
          })}
        >
          <span style={{ fontSize: '20px' }}>{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
