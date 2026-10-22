# Thread Name

Adds a Name field above the new-thread composer. Type a name, write the prompt, send. The thread shows up in the sidebar under that name instead of the first words of the prompt.

Leave the field empty and nothing changes. bb titles the thread the usual way.

## How it works

The composer can tell a plugin that a send went through, but not which thread it created. The server sees the thread but not the name. So each side reports what it knows and `match.ts` pairs them:

- `server.ts` answers the `message.dispatch` hook. When a person's first message lands in a thread they created in the last 30 seconds, with no title, no parent, and no sender thread, it records the thread and its project.
- `app.tsx` registers a banner on the new-thread composer. When the composer reports a send, it sends the name and the project id to the server over RPC.
- The first name and thread from the same project within 30 seconds of each other get paired, and the server calls `threads.update` with the title.

bb's automatic titles only fill in threads that have no title yet, so they don't overwrite the name.

## Limits

- The name is matched by project and timing. If someone in the same project starts a thread within the same few seconds, the name could land on theirs. In practice that means two threads started at once from two windows.
- The typed name lives in memory until you send. A page reload clears it.
- Scheduled sends ("send later") won't get the name, because their first message dispatches long after the 30-second window.

## Develop

```sh
npm install
npm test
npm run typecheck
bb plugin build && bb plugin reload thread-name
```
