import type { NativeChatMessage } from '../../../../shared/native-chat-types'

// Fixed sample data, like the terminal settings preview; never drawn from a user's chat.
export const NATIVE_CHAT_APPEARANCE_SAMPLE: NativeChatMessage[] = [
  {
    id: 'appearance-preview-user',
    role: 'user',
    source: 'transcript',
    timestamp: new Date(2026, 0, 1, 14, 14).getTime(),
    blocks: [
      {
        type: 'text',
        text: 'Why does `pnpm dev` exit right after it starts on Windows?'
      }
    ]
  },
  {
    id: 'appearance-preview-explanation',
    role: 'assistant',
    source: 'transcript',
    timestamp: null,
    blocks: [
      {
        type: 'text',
        text: [
          '```json',
          '"scripts": {',
          '  "dev": "node --env-file=.env.development scripts/dev.mjs"',
          '}',
          '```',
          '',
          'Use Node instead of **Unix-only** shell syntax.'
        ].join('\n')
      }
    ]
  },
  {
    id: 'appearance-preview-tools',
    role: 'assistant',
    source: 'transcript',
    timestamp: null,
    blocks: [
      {
        type: 'tool-call',
        name: 'Grep',
        input: { pattern: 'NODE_ENV=', path: 'scripts/' },
        state: 'completed'
      },
      {
        type: 'tool-call',
        name: 'Read',
        input: { file_path: 'package.json' },
        state: 'completed'
      }
    ]
  },
  {
    id: 'appearance-preview-answer',
    role: 'assistant',
    source: 'transcript',
    timestamp: null,
    blocks: [
      {
        type: 'text',
        text: 'Then run `pnpm dev` again. No other script uses the old form.'
      }
    ]
  }
]
