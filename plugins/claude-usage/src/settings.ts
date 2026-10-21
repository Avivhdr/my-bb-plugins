import { z } from 'zod'

export const SETTINGS = {
  rescanMinutes: {
    type: 'number',
    label: 'Rescan interval (minutes)',
    description: 'How often to read new Claude Code transcripts, from 1 to 240 minutes.',
    default: 5,
    experimental_schema: z.number().int().min(1).max(240),
  },
} as const
