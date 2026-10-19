import type {
  CalendarEvent,
  GraphProfile,
  MailMessage,
  NewEvent,
  SendOutcome,
  UserGraph,
} from '../ports';
import { toGraphError, type GraphClient } from './client';
import { graphMessage } from './mailer';

interface GraphEvent {
  id: string;
  subject: string | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  attendees?: {
    emailAddress: { address: string; name?: string };
    status?: { response?: string };
  }[];
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  isCancelled?: boolean;
  organizer?: { emailAddress?: { address?: string; name?: string } };
}

export function mapEvent(e: GraphEvent): CalendarEvent {
  return {
    id: e.id,
    subject: e.subject ?? '(no subject)',
    start: e.start.dateTime,
    end: e.end.dateTime,
    timeZone: e.start.timeZone,
    location: e.location?.displayName ?? '',
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.emailAddress.address,
      name: a.emailAddress.name ?? a.emailAddress.address,
      response: a.status?.response ?? 'none',
    })),
    isOnline: !!e.isOnlineMeeting,
    joinUrl: e.onlineMeeting?.joinUrl ?? null,
    webLink: e.webLink ?? null,
    isCancelled: !!e.isCancelled,
    organizer: e.organizer?.emailAddress?.name ?? e.organizer?.emailAddress?.address ?? '',
  };
}

const SELECT =
  'id,subject,start,end,location,attendees,isOnlineMeeting,onlineMeeting,webLink,isCancelled,organizer';

function eventBody(e: Partial<NewEvent>) {
  return {
    ...(e.subject !== undefined ? { subject: e.subject } : {}),
    ...(e.start !== undefined ? { start: { dateTime: e.start, timeZone: e.timeZone } } : {}),
    ...(e.end !== undefined ? { end: { dateTime: e.end, timeZone: e.timeZone } } : {}),
    ...(e.body !== undefined ? { body: { contentType: 'Text', content: e.body } } : {}),
    ...(e.location !== undefined ? { location: { displayName: e.location } } : {}),
    ...(e.attendees !== undefined
      ? { attendees: e.attendees.map((a) => ({ emailAddress: { address: a }, type: 'required' })) }
      : {}),
    ...(e.online !== undefined
      ? e.online
        ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }
        : { isOnlineMeeting: false }
      : {}),
  };
}

/** Delegated calls: everything runs with the signed-in employee's own token and permissions. */
export class GraphUserGraph implements UserGraph {
  constructor(private readonly graph: GraphClient) {}

  getProfile(): Promise<GraphProfile> {
    return this.graph.json<GraphProfile>({
      path: '/me?$select=id,displayName,mail,userPrincipalName,userType,accountEnabled',
    });
  }

  async sendMail(m: MailMessage): Promise<SendOutcome> {
    const res = await this.graph.raw({
      method: 'POST',
      path: '/me/sendMail',
      body: { message: graphMessage(m), saveToSentItems: true },
      retries: 0,
    });
    if (res.status === 202) return { status: 'accepted' };
    const err = await toGraphError(res);
    return {
      status: 'failed',
      error: `${err.status} ${err.code}`,
      retryable: err.status === 429 || err.status >= 500,
    };
  }

  async listEvents(startIso: string, endIso: string, timeZone: string): Promise<CalendarEvent[]> {
    const q = new URLSearchParams({
      startDateTime: startIso,
      endDateTime: endIso,
      $select: SELECT,
      $orderby: 'start/dateTime',
      $top: '50',
    });
    const body = await this.graph.json<{ value: GraphEvent[] }>({
      path: `/me/calendarView?${q.toString()}`,
      headers: { Prefer: `outlook.timezone="${timeZone.replace(/"/g, '')}"` },
    });
    return body.value.map(mapEvent);
  }

  async createEvent(e: NewEvent): Promise<CalendarEvent> {
    // Event creation sends invitations, so it is not retried automatically.
    return mapEvent(
      await this.graph.json<GraphEvent>({
        method: 'POST',
        path: '/me/events',
        body: eventBody(e),
        retries: 0,
      }),
    );
  }

  async updateEvent(id: string, patch: Partial<NewEvent>): Promise<CalendarEvent> {
    return mapEvent(
      await this.graph.json<GraphEvent>({
        method: 'PATCH',
        path: `/me/events/${encodeURIComponent(id)}`,
        body: eventBody(patch),
        retries: 0,
      }),
    );
  }

  async cancelEvent(id: string, comment: string): Promise<void> {
    await this.graph.json({
      method: 'POST',
      path: `/me/events/${encodeURIComponent(id)}/cancel`,
      body: { comment },
      retries: 0,
    });
  }
}
