import { ConsoleLogger, LogLevel } from '@nestjs/common';

/** One JSON object per line, ready for any log shipper. */
export class JsonLogger extends ConsoleLogger {
  protected printMessages(messages: unknown[], ctx = '', level: LogLevel = 'log', stream: 'stdout' | 'stderr' = 'stdout') {
    for (const m of messages)
      process[stream].write(JSON.stringify({ t: new Date().toISOString(), level, ctx, msg: typeof m === 'string' ? m : m }) + '\n');
  }
}
