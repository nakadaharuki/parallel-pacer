# parallel-pacer

Run several Claude Code chats side by side and their `npm install`s, builds and tests pile up until the PC freezes. This mod watches the PC's CPU, free memory and the chats running on it, **holds heavy commands back to one at a time while the PC is choked**, and says in the status line how many more chats fit.

```
3 chats (2 busy) · CPU 62% · 4.1 GB free · calm, room for 2 more
```

For Windows (it measures with PowerShell's `Get-CimInstance`). English and Japanese: the `language` option (`auto`, `en`, `ja`) follows Claude Code's `language` setting on `auto`.

## What it does

- **Status line**: chats in parallel, CPU, free memory, and how many more chats fit
- **Heavy work waits its turn**: while the PC is choked and another chat runs heavy work (install, build, test, typecheck, dev server…), a new heavy command is held back and Claude is told to run it again in 1 to 2 minutes. After 3 holds within 10 minutes it is let through, so nothing is stuck for good
- **A note for Claude**: only while the PC is choked, a note asks Claude to run heavy work one at a time (without cutting the request)
- **Toast**: once, when the PC turns tight or choked
- `/para`: the state and the rule. `/para off` stops the pacing, `/para on` brings it back

The thresholds suit a 16 GB laptop (tight = under 3.5 GB free or CPU 75%+, choked = under 2 GB free or CPU 90%+). Change them in the constants at the top of [hooks/register.tsx](hooks/register.tsx).

## Install

```
/plugin marketplace add nakadaharuki/parallel-pacer
/plugin install parallel-pacer@parallel-pacer
```

Claude Code v2.1.287 or later. It is also listed, pinned to a read commit with a manifest, at [modscode.com/mods/parallel-pacer](https://modscode.com/mods/parallel-pacer/).

## What it touches

Mods are not sandboxed, so here it is before you install. The code is one file, [hooks/register.tsx](hooks/register.tsx).

- No network (`$.http` is not used). No environment variables, no files
- One outside process: a reading every 30 seconds (`powershell -NoProfile -Command "Get-CimInstance ..."`). However many chats run, the PC takes one reading (they take turns through `$.store`)
- `$.store` holds the reading, a heartbeat per chat, and the kind of heavy command running (`npm install` and the like, never its arguments)
- It reads Claude Code's `language` setting to pick the language
- It watches `Bash` and `PowerShell` tool calls and may hold back heavy commands

## How it works

A mod runs once per session, in a process of its own. So what is one per PC (the reading, the count of heavy work) lives in `$.store`, which every chat reads, not in module variables. A chat whose heartbeat stops for 60 seconds is no longer counted.

## 日本語

PC の CPU・空きメモリと並列の会話数を見て、詰まっている間は重い処理（install・build・test など）を 1 本ずつに絞り、ステータス行に「あと何本並べられるか」を出します。表示は日本語にもなります（`language` の設定が `auto` なら Claude Code の `language` 設定に合わせる）。成分表と入れ方は [modscode.com/ja/mods/parallel-pacer](https://modscode.com/ja/mods/parallel-pacer/)。デスクトップ版の Mods で踏んだ罠は Zenn に: https://zenn.dev/nakadaharuki

MIT License
