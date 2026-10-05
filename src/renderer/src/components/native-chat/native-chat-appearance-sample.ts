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
        text: 'The dev script starts the server with a **Unix-only** shell line, so on Windows the child process fails and the parent exits with it.'
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
        text: [
          'Set the variable through Node instead of the shell, so it works everywhere:',
          '',
          '```json',
          '"scripts": {',
          '  "dev": "node --env-file=.env.development scripts/dev.mjs"',
          '}',
          '```',
          '',
          'Then run `pnpm dev` again. No other script uses the old form.'
        ].join('\n')
      }
    ]
  }
]
