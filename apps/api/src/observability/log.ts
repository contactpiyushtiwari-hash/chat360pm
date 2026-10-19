import type { AnalyticsSink, Logger } from '../ports';
import { redact, redactText } from './redact';

/** JSON-lines logger. Cloudflare Workers Logs indexes these fields. */
export function createLogger(
  base: Record<string, unknown> = {},
  sink: (line: string) => void = console.info,
): Logger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) => {
    sink(
      JSON.stringify({
        level,
        msg: redactText(msg),
        ...base,
        ...(fields ? (redact(fields) as object) : {}),
        ts: new Date().toISOString(),
      }),
    );
  };
  return {
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export function childLogger(log: Logger, fields: Record<string, unknown>): Logger {
  return {
    info: (m, f) => log.info(m, { ...fields, ...f }),
    warn: (m, f) => log.warn(m, { ...fields, ...f }),
    error: (m, f) => log.error(m, { ...fields, ...f }),
  };
}

/** Workers Analytics Engine sink: no content, no emails, only event names and coarse dimensions. */
export function analyticsEngineSink(
  dataset: AnalyticsEngineDataset | undefined,
  log: Logger,
): AnalyticsSink {
  return {
    track(event, props) {
      try {
        if (dataset) {
          dataset.writeDataPoint({
            indexes: [event],
            blobs: [
              event,
              props.role ?? '',
              props.projectId ?? '',
              props.outcome ?? '',
              props.userHash ?? '',
            ],
            doubles: [props.value ?? 1],
          });
        } else {
          log.info('analytics_event', { event, ...props });
        }
      } catch (err) {
        log.warn('analytics_write_failed', { event, error: String(err) });
      }
    },
  };
}

export class MemoryAnalytics implements AnalyticsSink {
  events: { event: string; props: Record<string, unknown> }[] = [];
  track(event: string, props: Record<string, unknown>) {
    this.events.push({ event, props });
  }
}
