# AI EDA Copilot

A **VS Code extension** that turns a natural-language description of a small
electronics project into structured, reviewable hardware-design artifacts, and
matches parts against JLCPCB / 嘉立创.

> Working name / V1 scope: general electronics maker & prototype-class projects
> (ESP32 / STM32 / Arduino, common sensors, small displays, basic power).

## What it does

A 5-stage AI pipeline produces, in order:

1. **RequirementSpec** — structured requirements (MCU, power, comms, display, sensors…), with each field labelled `user_provided` / `ai_inferred` and a confidence.
2. **BOM** — a JLC-style bill of materials (`comment` / `designator` / `footprint` / optional LCSC part #).
3. **Schematic Intent** — module-level connections, networks, and a pin table.
4. **PCB Layout Plan** — zoning, placement guidance, and routing constraints.
5. **Design Review** — a local rule engine (hard / warning / JLC rules) plus an AI deep review.

Inputs: free-form chat, a structured form, quick-start templates, or a local
**Arduino/ESP32 firmware folder scan** (regex heuristics that extract used
GPIO / libraries / peripherals — no AI tokens, deterministic).

Outputs are rendered in a dedicated Report webview and can be exported to
**Markdown / JSON / CSV** (BOM CSV aligns with the JLCPCB SMT template).

## Requirements

- Node.js (18+; developed on 20.x)
- VS Code `^1.96.0`
- An **OpenAI-compatible** API endpoint + key (the adapter speaks the OpenAI
  chat-completions shape and also supports an Anthropic-style top-level `system`
  field; the default model is `claude-sonnet-4-6`).

## Build

```bash
npm install
npm run compile      # tsc --noEmit (extension+shared) + esbuild (extension + 2 webviews)
```

Other scripts:

```bash
npm run check-types  # type-check extension + shared
npm test             # vitest — broad unit-test suite for pure-logic modules (260+ tests, and growing)
npm run package      # production build
```

> The exact test count moves as Phase 4 hardening lands; run `npm test` for the
> current number rather than relying on a figure quoted here.

## Run

1. Open this folder in VS Code.
2. Press `F5` (**Run Extension**) to launch an Extension Development Host.
3. Open the **AI EDA Copilot** view from the activity bar.
4. Configure your key: Command Palette → **AI EDA: Configure API Key**
   (stored encrypted in VS Code SecretStorage).

### Settings

| Setting | Default | Description |
|---|---|---|
| `aiEda.apiBaseUrl` | `""` | Base URL of the OpenAI-compatible relay |
| `aiEda.model` | `claude-sonnet-4-6` | Model used by the pipeline |
| `aiEda.reportLanguage` | `zh` | Report language (`zh` / `en`) |
| `aiEda.requestTimeoutMs` | `120000` | Per-request timeout (ms) for establishing the AI response. App-level retry owns retries. |
| `aiEda.streamIdleTimeoutMs` | `90000` | Max idle (ms) between streamed chunks before the stream is treated as stalled and aborted. |
| `aiEda.debugLogging` | `false` | Log raw AI response chunks to the output channel for diagnosis (verbose; may include response content). |

### Cancellation & lifecycle

The analysis pipeline supports **user-initiated cancellation**. Three end states are
kept distinct (and shown differently) — they must not be conflated:

- **Cancelled (user)** — you stopped the run. This is a *benign* "已取消 / Cancelled"
  state, **not an error or crash**, and it is **not retried**. Cancellation aborts the
  in-flight AI stream and any running procurement queries, then resets the running state.
- **Request timeout** — no AI response could be established within `requestTimeoutMs`.
- **Stream idle timeout** — the stream stalled with no new chunks for
  `streamIdleTimeoutMs` and was aborted.

Cancellation is **best-effort and cooperative** (signal-based): a request already in
flight on the network may still return, but its result is discarded. A cancelled
procurement item resolves to a benign "query not completed — please retry" state, which
is **not** the same as "out of stock".

## V1 limitations (read me)

To avoid over-claiming, here is what this project does **not** do yet:

- **No Verilog / HDL** parsing, **no simulation**, **no synthesis**. "EDA" here
  means *design-report generation + JLC part matching*, not an FPGA/ASIC toolchain.
- **No final schematic-file or PCB-file generation**, and **no routing output**.
- **No automatic ordering.** Procurement stops at compatibility checks, candidate
  mapping, and guidance.
- **JLC "compatible" is heuristic**, not verified — current matching is primarily a
  package/footprint-string match against a third-party search API. Matches are labelled
  *partial / needs-confirmation*, never "verified compatible"; always confirm value,
  rating, and MPN before purchasing.
- **Procurement data depends on an external third-party service** (`jlcsearch`) and can
  fail or be stale. Matching runs with **bounded concurrency** (default 5 in flight) and
  is **cancelable**; progress is reported as total / completed / failed. Stock/price are
  point-in-time and not guaranteed. Query failures (`network` / `api` / `parse` /
  `timeout`) are shown as **distinct states from "out of stock" / "not found"** and must
  not be read as a stock verdict; a cancelled query resolves to a benign "retry" state.
- **Design-review rules are heuristics**, not sign-off. Rule findings (e.g. decoupling
  coverage, footprint familiarity) are coarse static checks that require human review;
  passing a rule does not certify the design.
- The firmware **code analyzer is regex-based heuristics** (Arduino C/C++ only),
  not a real compiler/AST; ambiguous pin references are surfaced as open questions.
- **Cross-file pin-constant conflicts are detected heuristically**, not by a
  compiler/preprocessor: when the same constant name is `#define`/`const`-defined to
  different literal values across files, each definition's `file:line` and value are
  surfaced in the side-panel code-analysis preview for **human review**. Macro expansion,
  conditional compilation (`#ifdef`), and scope are not analysed, so this can miss or
  over-report — treat it as a hint, not a verdict.
- **Persistence writes are atomic** (temp file + rename), with a direct-write fallback
  where rename is unsupported; save failures are surfaced to the panel rather than
  silently dropped. An **index-rebuild capability is recovery-only**: it rescans session
  files to rebuild the index, **skipping corrupt files and keeping orphan files** —
  orphans are never auto-deleted and **no user data is removed**.
- **Cancellation is best-effort.** It aborts the in-flight stream and procurement queries
  and resets state, but cannot un-send a request already on the wire; results that arrive
  after cancel are discarded. Cancelling is never retried and never treated as an error.
- The "block diagram" view currently shows **Mermaid source text**, not a rendered diagram.
- AI output is parsed as JSON and rendered — it is **never executed**.

## Project layout

```
src/
├─ extension/   # VS Code extension host (Node): activate, adapters, services, prompts, rules, export, providers, analyzers
├─ webview/     # React UIs (browser): panel (side panel) + report (full report) + shared
└─ shared/      # types + constants shared by both sides
docs/           # PRD, tech stack, backend structure, implementation plan, app flow
```

## License

MIT
