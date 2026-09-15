interface DockItem {
  id: string;
  label: string;
  iconSvg: string;
  iconColor: string;
  iconColor2: string;
}

interface SideDockProps {
  items: DockItem[];
  onRestore: (id: string) => void;
  hidden?: boolean;
}

export default function SideDock({ items, onRestore, hidden }: SideDockProps) {
  if (items.length === 0) return null;

  return (
    <div className={`minimized-dock${hidden ? ' hidden' : ''}`}>
      {items.map((item) => (
        <div
          key={item.id}
          className="dock-bubble"
          onClick={() => onRestore(item.id)}
          style={{
            background: `linear-gradient(135deg, ${item.iconColor}, ${item.iconColor2})`,
          }}
          title={item.label}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: item.iconSvg }}
          />
          <span className="dock-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
