import { writeFile } from 'node:fs/promises';
import { createCalendarFile } from '../calendar.mjs';

await writeFile(new URL('../assets/becky-alex-wedding.ics', import.meta.url), createCalendarFile());
console.log('Updated the all-day wedding calendar file.');
