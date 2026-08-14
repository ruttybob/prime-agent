# PA-contrib-migration — перенос вкладов под новый trusted-contribution процесс

> Статус на 2026-08-14: **PAUSED, вернёмся позже.**
> Причина паузы: у org PrimeIntellect включён запрет OAuth-приложений — токен gh CLI (`gho_`) не может
> писать в их репо (CreateDiscussion → 403, даже reaction → 403 "Must have admin rights").
> Писать в свой форк тем же токеном можно. Это не обходится `gh auth refresh`/re-login — нужен classic PAT.

## Как возобновить

1. Создать classic PAT (scope: только `public_repo`): Settings → Developer settings →
   Personal access tokens → **Tokens (classic)** → Generate new token.
2. `gh auth login` → GitHub.com → HTTPS → «Paste an authentication token».
3. Проверка записи: `gh api -X POST repos/PrimeIntellect-ai/prime-agent/issues/1244/reactions -f content=+1`
   (должен вернуть JSON с id; потом реакцию удалить).
4. Опубликовать 6 Discussions ниже (мутация GraphQL `createDiscussion`,
   repoId `R_kgDOSXZbXg`; категории: Bug reports `DIC_kwDOSXZbXs4DDRZ9`,
   Feature requests `DIC_kwDOSXZbXs4DDRZ-`).
5. Закрыть 6 PR и 6 issues комментариями из разделов ниже (подставив номера созданных Discussions).

**Важно:** не переоткрывать закрытое — гейт `contribution-gate.yml` срабатывает на opened/reopened.
`gho_`-токеном эти действия НЕ выполнить (см. память сессии `prime_agent_ruttybob_contributions_rework_state`).

## Контекст процесса (upstream #1340, commit 9f9501146)

- Intake теперь ТОЛЬКО через Discussions (Bug reports / Feature requests / General; формы-шаблоны).
- Issues и PR от не-vouched контрибьюторов автозакрываются workflow с vouch-экшеном.
- `.github/VOUCHED.td` пока пуст. Vouch зарабатывают полезными Discussions/investigation.
- Существующие (до-гейт) issues/PR не закрыты, но ревью PR не будет.

## Соответствие: старое → новое

| Draft | Категория | Из issue | Соотв. PR (закрыть) | Черновик |
|---|---|---|---|---|
| ghost | Bug reports | #1078 | #1079 | 01 |
| glm | Bug reports | #1074 | #1075 | 02 |
| selection | Bug reports | #1088 | #1089 | 03 |
| cwd | Feature requests | #1090 | #1092 | 04 |
| ctrlc | Feature requests | #1097 | #1098 | 05 |
| mermaid | Feature requests | #1244 | #1246 (дубль #1245 уже закрыт) | 06 |

## Отложено после публикации

- Re-проверка ghost-сессий (#1078) на текущем main (0.7.2+): empty-draft discard частично закрыт
  upstream (#269, #326, #850, #852) — перед постингом проверить, что осталось (leases), и поправить черновик 01.


---

## Draft 01 — Empty draft session files (ghost sessions) and orphaned session leases accumulate on shutdown <a name="d01"></a>

- **Категория:** Bug reports
- **Перенос из:** issue #1078, закрываемый PR #1079

**Title:**
```
[Bug] Empty draft session files (ghost sessions) and orphaned session leases accumulate on shutdown
```

**Body:**

**Affected area:** Agent core

**What happened?**

Empty session files accumulate in `~/.prime/agent/sessions/` after daemon shutdown or update restarts. These "ghost sessions" contain zero messages — only the 4 bootstrap entries (`session`, `model_change`, `thinking_level_change`, `service_tier_change`) plus a daemon-written `session_state: active`. They appear as "(no messages)" in the TUI and can never be cleaned up without manual `rm`.

Additionally, session-lease directories (`~/.prime/agent/session-leases/<hash>.lock/`) are left behind when a daemon exits without releasing: on the affected install **5 of 9** lease directories were orphaned (owner PID dead, never reclaimed). `reclaimStaleLease()` is reactive only — there is no startup sweep, so orphans accumulate forever.

**Steps to reproduce**

1. Start `prime-agent` (opens a new session), send no message
2. Exit (`Ctrl+C` or `/exit`)
3. Check `~/.prime/agent/sessions/` — the empty `.jsonl` is still there

Ghost anatomy (`wc -c` = 768 bytes):

```
$ cat ~/.prime/agent/sessions/<ghost-id>.jsonl | jq .type
"session"
"model_change"
"thinking_level_change"
"service_tier_change"
"session_state"
```

**Expected behavior**

Empty draft sessions should be discarded on clean shutdown, and lease directories with dead owner PIDs should be reclaimed at startup.

**Prime Agent version:** 0.7.1

**Environment:** macOS (Darwin); provider-independent

**Additional context**

Root cause (investigated on 0.7.1): `addRuntime()` calls `sessionManager.appendSessionState({ status: "active" })` for every non-subagent session, and `session_state` bypasses the no-assistant guard in `_persist()` — so the file is created before any user message (intentional, for crash recovery). But in `closeSessionOnce()`:

```ts
const keepsResumeEntry = this.closeKeepsResumeEntry(reason);      // true for "shutdown" | "update"
const isEmptyDraftSession = !keepsResumeEntry && this.isEmptyDraftContent(state);
//                     ↑ ALWAYS FALSE for shutdown/update → deleteSessionFile() never reached
```

For shutdown/update the empty-draft delete is never reached. Evidence this is an unintended side effect rather than design: `createUpdateRestartSession()` already excludes empty drafts from the restart manifest, `worker_archive_and_shutdown` routes closes through the `killed` path specifically so empty drafts get deleted, and `detachClientFromSession()` → `isDiscardableDraft()` implements the correct discard logic elsewhere.

Proposed direction (mirroring `isDiscardableDraft()`): gate on `isEmptyDraftContent(state) && !isActiveSessionBusy(state)` instead of `!keepsResumeEntry`, plus best-effort startup sweeps for stale leases and ghost session files. I have this implemented with tests on a branch and can share details or rebase onto current main if useful.

Note: I originally reported this against 0.7.1, and related lifecycle hardening has landed since (e.g. #852, #850). I plan to re-verify the remaining scope on current `main` and follow up here.


---

## Draft 02 — Z.AI GLM: reasoning_effort never sent, so /effort levels have no effect <a name="d02"></a>

- **Категория:** Bug reports
- **Перенос из:** issue #1074, закрываемый PR #1075

**Title:**
```
[Bug] Z.AI GLM: reasoning_effort never sent, so /effort levels have no effect
```

**Body:**

**Affected area:** AI providers and models

**What happened?**

Z.AI models with `thinkingFormat: "zai"` only send `enable_thinking: true/false` in API requests — `reasoning_effort` is never sent. Selecting different effort levels in `/effort` therefore has no effect: the API receives identical requests for `high` and `max`. Additionally, Z.AI models have no `thinkingLevelMap`, so the selector offers levels that are meaningless for these models.

Two root causes, both still present on current `main` (verified on 9f9501146, post-#1258):

1. `detectCompat` hardcodes Z.AI off (`openai-completions.ts:1119`):
   ```ts
   supportsReasoningEffort: !isGrok && !isZai && !isMoonshot && !isCloudflareAiGateway,
   ```
2. The `thinkingFormat: "zai"` handler only sets the boolean toggle (`openai-completions.ts:569`):
   ```ts
   if (compat.thinkingFormat === "zai" && model.reasoning) {
       (params as any).enable_thinking = !!options?.reasoningEffort;
   }
   ```

**Steps to reproduce**

1. Configure a Z.AI GLM model (e.g. `glm-5.2`) and open `/effort`
2. All 7 thinking levels are listed (no `thinkingLevelMap`)
3. Switch between `high` and `max` — requests to `https://api.z.ai/api/coding/paas/v4/chat/completions` are identical apart from the boolean

**Expected behavior**

Effort levels should map to a `reasoning_effort` request parameter, and the `/effort` selector should only show levels the model actually distinguishes.

**Prime Agent version:** observed on 0.7.1, re-verified on `main` @ 9f9501146

**Environment:** macOS (Darwin)

**Additional context**

Measured on `glm-5.2` with `thinking` + `reasoning_effort` sent manually — the API does honour effort levels:

| Effort | Reasoning (chars) | Completion tokens | Latency | Behavior |
|--------|-------------------|-------------------|---------|----------|
| off    | 0                 | 192               | 4.0s    | No CoT, friendly answer |
| high   | 1,012             | 456               | 6.2s    | Direct solution |
| max    | 3,202             | 982               | 15.0s   | Explores all branches, validates answer |

`glm-4.7`, `glm-5-turbo`, `glm-5.2` all accept `thinking.type` + `reasoning_effort` alongside `enable_thinking` without conflict.

Upstream `pi` already fixed this direction (earendil-works/pi#5770 effort levels for GLM-5.2; #6083 `clear_thinking: false` for Z.AI caching).

Proposed fix sketch: add a `thinkingLevelMap` for Z.AI reasoning models in `generate-models.ts` (levels `[off, low, medium, high, max]` with `low`/`medium` aliasing to `high`), set `supportsReasoningEffort: true` in their compat, and upgrade the `zai` handler to also send `reasoning_effort` mapped through the level map. I have a working implementation with tests on a branch and can share it if invited.


---

## Draft 03 — TUI: mouse selection highlight disappears immediately on release (flicker) <a name="d03"></a>

- **Категория:** Bug reports
- **Перенос из:** issue #1088, закрываемый PR #1089

**Title:**
```
[Bug] TUI: mouse selection highlight disappears immediately on release (flicker)
```

**Body:**

**Affected area:** TUI

**What happened?**

In the fullscreen TUI, mouse text selection (drag-select, double-click word, triple-click line) clears the highlight the instant the mouse button is released. The selected text is copied to the clipboard, but the visual feedback disappears immediately — it reads as a flicker, with no confirmation of what was selected.

**Steps to reproduce**

1. Open `prime-agent` in fullscreen mode
2. Drag to select text → highlight appears (reverse video)
3. Release the mouse button → highlight disappears instantly, text is copied

**Expected behavior**

The selection highlight should persist after mouse release and only clear when the user clicks elsewhere or starts a new selection — matching standard terminal emulators (iTerm2, Terminal.app, Alacritty).

**Prime Agent version:** 0.7.1

**Environment:** macOS (Darwin)

**Additional context**

Root cause: `endSelection()` / `endFrameSelection()` in `packages/tui/src/fullscreen.ts` call `clearSelection()` as part of ending the selection. Fix direction is to decouple text extraction/copy from clearing: `endSelection()` returns the selected text without clearing, selection state (anchor, head, mode) persists for the next render, and the next `beginSelection` / `beginWordSelection` / `beginLineSelection` clears the old highlight first. Mouse release handlers in `tui.ts` already call `endActiveSelection()` then `requestRender()`, so no change needed there.

I have a working implementation (new regression test: selection remains highlighted after release and clears on next click; all 47 existing selection tests pass) on a branch and can share it if invited.


---

## Draft 04 — Show current working directory in the editor status line <a name="d04"></a>

- **Категория:** Feature requests
- **Перенос из:** issue #1090, закрываемый PR #1092

**Title:**
```
[Feature] Show current working directory in the editor status line
```

**Body:**

**Area:** TUI / Coding agent and CLI

**Problem**

When working across multiple projects or sessions, it is easy to lose track of which directory the agent is operating in. The cwd is shown in the splash screen and in the terminal title, but not in the persistent status line where it would be most visible during active use:

```
agents/resume  GLM-5.2 • max
```

**Proposed direction**

Add the current working directory as a new segment in the editor status line after the model label:

```
agents/resume  GLM-5.2 • max  ~/pets/prime-agent
```

Format it home-relative and truncate long paths (the existing `formatSplashCwd()` and `truncatePathMiddle()` helpers already provide both).

Open question: should this be default behavior, or behind a setting? Happy either way.

**Alternatives considered**

- Terminal title already contains the cwd, but it is often truncated by the terminal and not visible in fullscreen mode
- A `/cwd` command or checking `pwd` via a tool call answers the question once, but is not persistent

**Additional context**

I have a working implementation on a branch (new segment + formatting + tests) and can share it if invited.


---

## Draft 05 — Clear the prompt with Ctrl+C when it has content and no operation is running <a name="d05"></a>

- **Категория:** Feature requests
- **Перенос из:** issue #1097, закрываемый PR #1098

**Title:**
```
[Feature] Clear the prompt with Ctrl+C when it has content and no operation is running
```

**Body:**

**Area:** TUI / Coding agent and CLI

**Problem**

When the prompt editor has content (a long draft, hints, etc.), there is no quick way to clear it — text has to be deleted line by line with backspace. Ctrl+C currently does nothing useful when the editor has content and nothing is running: it falls through to `handleInterruptKey()`, which is a no-op in the idle state.

**Proposed direction**

Ctrl+C clears the prompt only when **both** are true: the editor has content, and no operation is running (`!hasInterruptibleWork()` — no streaming, bash, compaction, retry, etc.). When an operation IS running, Ctrl+C still interrupts it and preserves the draft (unlike the earlier #845 approach, which unconditionally cleared and could lose the draft mid-interrupt).

| State | Ctrl+C action |
|---|---|
| Editor has content, idle | Clear prompt |
| Streaming / bash / retry / compaction | Interrupt operation, preserve draft |
| Editor empty, idle | Exit hint → second Ctrl+C exits |

To be fair to the counter-argument raised by @alexanderkjeldaas in #1098: traditional Unix TUIs don't use Ctrl+C for text editing, `Ctrl+A Ctrl+K` already clears, and in sluggish TUIs a second Ctrl+C intended as "clear again" can exit the program and lose state. The counter-counter-point: the exit hazard exists today in the empty-editor path regardless (second Ctrl+C exits after a hint), and gating "clear" strictly on idle-state makes the first Ctrl+C's effect unambiguous. Both concerns are legitimate — opening this discussion to settle the design rather than assume.

**Alternatives considered**

- `Ctrl+A Ctrl+K` (existing chord): works, but is a two-chord sequence and undiscoverable
- A dedicated `/clear-prompt` command: discoverable but slower than a keypress for a frequent action

**Additional context**

I prototyped this in #1098 (closing it now per the new contribution process). Implementation is small: 4 lines in `handleCtrlC()` checking `editor.getText().length > 0 && !hasInterruptibleWork()` before falling through, plus hotkey-guide and test updates. Can rebase onto current main if invited.


---

## Draft 06 — Render Mermaid diagrams as inline Unicode art in chat (as pi already does) <a name="d06"></a>

- **Категория:** Feature requests
- **Перенос из:** issue #1244, закрываемый PR #1246 (+ closed dup #1245)

**Title:**
```
[Feature] Render Mermaid diagrams as inline Unicode art in chat (as pi already does)
```

**Body:**

**Area:** TUI / Coding agent and CLI

**Problem**

When the assistant generates a Mermaid diagram (flowchart, sequence, etc.), the raw fenced source is shown in a code block. Terminal users cannot visualize it without copying it out to a renderer, which breaks the flow of reading the response.

**Proposed direction**

Render Mermaid code blocks as inline Unicode box-drawing art directly in the chat.

The strongest argument for feasibility: **pi already ships exactly this feature.** Prime Agent's TUI is built on top of pi, and pi renders Mermaid via [`grok-mermaid`](https://www.npmjs.com/package/grok-mermaid) in [`packages/coding-agent/src/modes/interactive/components/mermaid.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/mermaid.ts) — a markdown transformer that finds mermaid fenced blocks, renders them to styled Unicode art, and maps spans to theme colors. As a daily pi user I found this genuinely convenient and useful: diagrams become readable without leaving the terminal. Porting the same approach should be low-risk since it is proven in the upstream project.

Concretely:
1. Optional `transform` callback on the TUI `Markdown` component, applied after tab normalization and before markdown parsing
2. A `mermaid-transformer` module in `packages/coding-agent` using `grok-mermaid`
3. Wire into assistant text blocks and user messages (not thinking blocks)
4. Settings toggle for the rendering mode: `streaming` (default) / `off` (raw source)
5. Fall back to raw source when rendering fails or the diagram is wider than the terminal

**Alternatives considered**

- Render to an image and view externally — leaves the terminal, heavy for a chat flow
- Open in a browser-based renderer — same flow break

**Additional context**

I have a working implementation (transform hook + transformer module + settings toggle + tests) on a branch, modeled on pi's approach, and can share or rebase it if invited.


---

## Комментарии для закрытия PR (после создания Discussions подставить номера)

### PR #1075 (GLM reasoning_effort)

```
Closing per the new contribution process — moved to Bug reports Discussion #___.
Happy to rebase this branch onto current main if a maintainer invites implementation.
```

### PR #1079 (ghost sessions)

```
Closing per the new contribution process — moved to Bug reports Discussion #___.
Happy to rebase this branch onto current main if a maintainer invites implementation.
```

### PR #1089 (mouse selection)

```
Closing per the new contribution process — moved to Bug reports Discussion #___.
Happy to rebase this branch onto current main if a maintainer invites implementation.
```

### PR #1092 (cwd in status line)

```
Closing per the new contribution process — moved to Feature requests Discussion #___.
Happy to rebase this branch onto current main if a maintainer invites implementation.
```

### PR #1098 (Ctrl+C clears prompt)

```
Closing per the new contribution process — moved to Feature requests Discussion #___.
Thanks @alexanderkjeldaas for the design feedback here; I've folded both sides of the argument into the discussion.
```

### PR #1246 (mermaid unicode)

```
Closing per the new contribution process — moved to Feature requests Discussion #___.
Happy to rebase this branch onto current main if a maintainer invites implementation.
```

## Шаблон комментария для закрытия исходных issues

```
Moving this to Discussions per the new contribution process: <ссылка>.
Continuing the conversation there; closing this issue to keep the intake queue clean.
```
