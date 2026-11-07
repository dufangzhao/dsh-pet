/**
 * 时间、体积与任务产物的短文案。
 * 时间统一用 24 小时制，和聊天记录的时间戳保持同一套读法。
 */
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function clockTime(timestamp: number): string {
  return timeFormat.format(timestamp);
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
