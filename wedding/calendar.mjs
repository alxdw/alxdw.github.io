export const weddingEvent = Object.freeze({
  title: 'Becky & Alex’s wedding',
  start: '20270911',
  end: '20270912', // All-day DTEND is exclusive: this is ONE day, September 11.
  location: 'Nottinghamshire',
  description: 'Save the date! We’re getting married in Nottinghamshire. A formal invitation with the venue and timings will follow.',
  uid: 'becky-alex-wedding-20270911@w5y.me',
  createdAt: '20261028T000000Z',
});

export function googleCalendarUrl() {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.search = new URLSearchParams({
    action: 'TEMPLATE', text: weddingEvent.title,
    dates: `${weddingEvent.start}/${weddingEvent.end}`,
    location: weddingEvent.location, details: weddingEvent.description,
  }).toString();
  return url.href;
}

const escapeText = (value) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

// RFC 5545: fold at 75 octets, without splitting a UTF-8 character.
function fold(line) {
  const encoder = new TextEncoder();
  let result = '', length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { result += '\r\n '; length = 1; }
    result += character;
    length += bytes;
  }
  return result;
}

export function createCalendarFile() {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Becky and Alex//Wedding//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${weddingEvent.uid}`, `DTSTAMP:${weddingEvent.createdAt}`,
    `DTSTART;VALUE=DATE:${weddingEvent.start}`, `DTEND;VALUE=DATE:${weddingEvent.end}`,
    `SUMMARY:${escapeText(weddingEvent.title)}`, `LOCATION:${escapeText(weddingEvent.location)}`,
    `DESCRIPTION:${escapeText(weddingEvent.description)}`,
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}
