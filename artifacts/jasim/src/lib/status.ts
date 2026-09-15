import { RuntimeTaskStatus } from "@workspace/api-client-react";

export function getStatusVariant(status: RuntimeTaskStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" {
  switch (status) {
    case RuntimeTaskStatus.completed:
      return "success";
    case RuntimeTaskStatus.failed:
      return "destructive";
    case RuntimeTaskStatus.blocked:
      return "warning";
    case RuntimeTaskStatus.planning:
    case RuntimeTaskStatus.ready:
      return "info";
    case RuntimeTaskStatus.awaiting_input:
    case RuntimeTaskStatus.awaiting_approval:
      return "warning";
    default:
      return "default";
  }
}

export function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}