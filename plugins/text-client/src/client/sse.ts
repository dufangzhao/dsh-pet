/**
 * 增量 SSE 解码器。
 *
 * 只做协议分帧：按空行切分事件，支持 CRLF、注释行和多行 `data`。
 * 事件语义（`companion` / `refresh`）在 protocol.ts 里判断，这里不掺业务。
 */
export interface SseMessage {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

const LINE_BREAK = /\r\n|\n|\r/;

export class SseDecoder {
  #buffer = '';
  #event: string | null = null;
  #id: string | null = null;
  #data: string[] = [];
  #size = 0;

  push(chunk: string): SseMessage[] {
    this.#buffer += chunk;
    const messages: SseMessage[] = [];
    for (;;) {
      const match = LINE_BREAK.exec(this.#buffer);
      if (match === null) break;
      const index = match.index;
      // 末尾单独的 \r 可能是下一片里 \r\n 的前半段，等下一片再判断。
      if (match[0] === '\r' && index === this.#buffer.length - 1) break;
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + match[0].length);
      const message = this.#line(line);
      if (message !== null) messages.push(message);
    }
    if (this.#buffer.length > 64 * 1024) throw new Error('SSE line budget exceeded');
    return messages;
  }

  /** EOF 可以结束末尾 CR；未闭合事件只报告，不把半帧当消息投递。 */
  finish(onIncomplete?: (event: string | null) => void): SseMessage[] {
    const messages = this.#buffer.endsWith('\r') ? this.push('\n') : [];
    const incomplete =
      this.#event !== null ||
      this.#id !== null ||
      this.#data.length > 0 ||
      (this.#buffer.length > 0 && !this.#buffer.startsWith(':'));
    const event = this.#event;
    this.#buffer = '';
    this.#event = null;
    this.#id = null;
    this.#data = [];
    this.#size = 0;
    if (incomplete) onIncomplete?.(event);
    return messages;
  }

  #line(line: string): SseMessage | null {
    if (line.length > 64 * 1024) throw new Error('SSE line budget exceeded');
    if (line === '') {
      this.#size = 0;
      if (this.#data.length === 0) {
        this.#event = null;
        this.#id = null;
        return null;
      }
      const message: SseMessage = {
        event: this.#event ?? 'message',
        data: this.#data.join('\n'),
        id: this.#id,
      };
      this.#event = null;
      this.#id = null;
      this.#data = [];
      return message;
    }
    if (line.startsWith(':')) return null;
    this.#size += line.length + 1;
    if (this.#size > 64 * 1024) throw new Error('SSE event budget exceeded');
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') this.#event = value;
    else if (field === 'data') this.#data.push(value);
    else if (field === 'id') this.#id = value;
    return null;
  }
}
