export function formatMessageTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join("-")
  const time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":")
  return `${date} ${time}`
}
