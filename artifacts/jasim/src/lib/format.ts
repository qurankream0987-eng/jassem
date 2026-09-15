import { format } from "date-fns"

export function formatDate(dateString: string) {
  try {
    return format(new Date(dateString), "MMM d, yyyy HH:mm:ss")
  } catch (e) {
    return dateString
  }
}
