// One realistic agent request, split into the blocks that fill a context
// window: instructions, tool definitions, a short conversation, a tool call
// and its result. The numbers in the tool result are sample data.
import type { FunctionTool } from '#shared/llm.ts'

export const INSTRUCTIONS = `You are Atlas, a travel assistant inside a trip-planning app.

# Goal
Help the user plan trips: routes, travel times, weather and calendar entries.

# Rules
- Answer in the user's language. Keep answers short: two to four sentences, then a list if it helps.
- Use tools for facts that change: distances, travel times, weather, opening hours. Never guess them.
- Call maps_distance before you state a distance or a driving time.
- Call weather_forecast for any day in the next 10 days. For later days, say that no forecast exists yet.
- Create a calendar event only when the user asks for it. Repeat the title, date and time before you create it.
- When a tool fails, say what failed and offer one next step.
- Use kilometers and 24-hour time, unless the user uses miles or AM/PM.

# Context
Today is Monday, 5 October 2026. The user's home city is Paris, France.`

export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'maps_distance',
    description:
      'Distance and travel time between two places, with the main route.',
    parameters: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Start address or city, for example "Paris, France".',
        },
        destination: { type: 'string', description: 'End address or city.' },
        mode: {
          type: 'string',
          enum: ['driving', 'transit', 'walking', 'cycling'],
        },
        depart_at: {
          type: 'string',
          description: 'Local departure time, ISO 8601. Optional.',
        },
      },
      required: ['origin', 'destination', 'mode'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'weather_forecast',
    description: 'Daily forecast for a city, up to 10 days ahead.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        units: { type: 'string', enum: ['metric', 'imperial'] },
      },
      required: ['city', 'date'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'calendar_create_event',
    description:
      "Creates an event in the user's calendar. Ask before you call it.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'Local start time, ISO 8601.' },
        end: { type: 'string', description: 'Local end time, ISO 8601.' },
        location: { type: 'string' },
        guests: {
          type: 'array',
          items: { type: 'string', description: 'Email address.' },
        },
      },
      required: ['title', 'start', 'end'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'web_search',
    description:
      'Searches the web. Use it for opening hours, events and prices.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

export const CONVERSATION: { role: 'user' | 'assistant'; text: string }[] = [
  { role: 'user', text: "Hi! I'm planning a weekend trip with two friends." },
  {
    role: 'assistant',
    text: 'Sounds fun. Where would you like to go, and how will you travel?',
  },
  {
    role: 'user',
    text: "We're driving from Paris to Lyon on Saturday morning. How long is the drive, and will it rain in Lyon?",
  },
]

export const TOOL_CALL = {
  callId: 'call_route_1',
  name: 'maps_distance',
  arguments: JSON.stringify({
    origin: 'Paris, France',
    destination: 'Lyon, France',
    mode: 'driving',
    depart_at: '2026-10-10T08:00',
  }),
}

export const TOOL_RESULT = JSON.stringify({
  origin: 'Paris, France',
  destination: 'Lyon, France',
  mode: 'driving',
  distance_km: 465,
  duration_min: 268,
  duration_in_traffic_min: 291,
  tolls_eur: 38.6,
  route: 'A6 (Autoroute du Soleil)',
  steps: [
    { instruction: 'Head south on Boulevard Périphérique', km: 6.2 },
    { instruction: 'Take exit Porte d’Italie toward A6 / Lyon', km: 1.1 },
    { instruction: 'Continue on A6', km: 112.4 },
    {
      instruction: 'Keep left at the fork to stay on A6 toward Auxerre',
      km: 58.7,
    },
    { instruction: 'Continue on A6 past Beaune', km: 176.3 },
    { instruction: 'Keep right toward Mâcon / Lyon', km: 64.8 },
    { instruction: 'Continue on A6 into Lyon', km: 39.5 },
    { instruction: 'Take exit 36 toward Lyon Centre', km: 4.2 },
    { instruction: 'Arrive at Lyon, Place Bellecour', km: 1.8 },
  ],
  warnings: [
    'Heavy traffic expected near Fontainebleau between 08:30 and 10:00 on Saturdays.',
  ],
  data_source: 'sample data',
})
