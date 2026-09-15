/**
 * Arabic labels and formatting helpers for the JASIM runtime model.
 * Labels mirror the truthful runtime states — nothing here upgrades a
 * blocked or pending state into a success.
 */

export function statusLabel(status: string): string {
  switch (status) {
    case 'planning':
      return 'قيد التخطيط';
    case 'awaiting_input':
      return 'بانتظار السياق';
    case 'awaiting_approval':
      return 'بانتظار الموافقة';
    case 'ready':
      return 'جاهزة للتنفيذ';
    case 'completed':
      return 'مكتملة';
    case 'blocked':
      return 'متوقفة';
    case 'failed':
      return 'فشلت';
    default:
      return status;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'planning':
      return '#4a9eff';
    case 'awaiting_input':
      return '#FFD700';
    case 'awaiting_approval':
      return '#ec4899';
    case 'ready':
      return '#00d4ff';
    case 'completed':
      return '#00c896';
    case 'blocked':
      return '#FF6B00';
    case 'failed':
      return '#ff6b6b';
    default:
      return '#94a3b8';
  }
}

export function eventLabel(type: string): string {
  switch (type) {
    case 'created':
      return 'إنشاء';
    case 'world_composed':
      return 'تكوين العالم';
    case 'awaiting_input':
      return 'طلب سياق';
    case 'awaiting_approval':
      return 'طلب موافقة';
    case 'action_accepted':
      return 'قبول إجراء';
    case 'plan_approved':
      return 'اعتماد الخطة';
    case 'execution_blocked':
      return 'إيقاف التنفيذ';
    case 'completed':
      return 'اكتمال';
    case 'failed':
      return 'فشل';
    default:
      return type;
  }
}

export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function newIdempotencyKey(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
