export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' }).format(new Date(iso))
}

export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}
