# crescode-engine WebSocket protocol (v1)

Transport: WebSocket on `ws://127.0.0.1:<port>` only. Messages are JSON objects with `type` and `id` (string). Replies reuse the request `id`. All times in ticks (960 PPQ). Always address instruments by `groupId` from the project schema.

| Direction | type | payload |
|---|---|---|
| UI→E, E→UI | `engine/hello` | `{ protocolVersion: 1, client? , engineVersion? }` — handshake; UI closes on mismatch |
| UI→E / E→UI | `engine/ping` / `engine/pong` | heartbeat every 2 s; UI reconnects if no pong for 6 s |
| E→UI | `engine/status` | `{ groups: [{ groupId, loaded, pluginId, frozenTracks }], cpu, memoryBytes }` |
| E→UI | `engine/error` | `{ message }` |
| UI→E | `scan/start` | `{ directory }` |
| E→UI | `scan/progress` | `{ loaded, total }` |
| E→UI | `scan/result` | `{ plugins: [{ id, name, vendor, path }], failed: [path] }` |
| UI→E | `plugin/load` | `{ groupId, pluginId, state: base64 \| null }` → E replies `plugin/loaded { groupId, ok, error? }` |
| UI→E | `plugin/openEditor` / `plugin/closeEditor` / `plugin/unload` | `{ groupId }` |
| E→UI | `plugin/state` | `{ groupId, state: base64 }` (getStateInformation, sent after editor close / on save) |
| UI→E | `transport/play` `transport/stop` `transport/seek` `transport/loop` | `{ tick }` / `{}` / `{ tick }` / `{ enabled, startTick, endTick }` |
| UI→E | `midi/setSequence` | `{ ppq, bpm, timeSignature, groups: [{ groupId, channels: [{ channel, trackId, notes[] }] }] }` |
| UI→E | `mixer/setState` | `{ masterVolume, tracks: [{ trackId, groupId, channel, volume, pan, mute, solo }] }` |
| UI→E | `audio/listDevices` → reply `{ devices: [{ id, name, type: 'ASIO'\|'WASAPI' }] }` | |
| UI→E | `audio/setDevice` | `{ device, bufferSize: 256 \| 512 }` |
| E→UI | `audio/levels` | `{ groups: { [groupId]: { peak, rms } } }` streamed while playing |
| UI→E | `track/freeze` / `track/unfreeze` | `{ trackId, groupId }` |

The UI client lives in `src/engineClient/client.ts`. Rules: a group holds ≤16 tracks; each track plays on its own channel of the group's instance; the instance unloads only when every member track is frozen.
