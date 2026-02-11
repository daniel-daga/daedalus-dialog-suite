# Parser Component Code Review

Date: 2026-02-11  
Scope: `daedalus-parser/src/core`, `daedalus-parser/src/semantic`, and shared parser utilities.

## Executive summary

The parser component is generally well-structured (clear two-pass semantic walk, dedicated action/condition parser modules), but there are several correctness and maintenance risks:

1. **One confirmed functional bug** in comment extraction (`extractComments`) due to missing source retention.
2. **Data-loss parsing behaviors** in argument normalization (`replace(/"/g, '')`) used in two parser modules.
3. **Potential semantic drift** in binary condition parsing due to left-operand assumptions.
4. **Observability/perf edge-cases** (unsafe throughput division, parser singleton reuse in utility module).
5. **Duplication and inconsistent normalization logic** that increase maintenance burden.

---

## Detailed findings

### 1) `extractComments` cannot work with normal `parse()` output (high)

**What happens**
- `extractComments` pulls source from `parseResult.sourceCode`.
- `parse()` never sets `sourceCode` on its return object.
- Result: comment text slices are computed from `''` and return empty strings.

**Evidence**
- `parse()` return object has no `sourceCode` field.【F:daedalus-parser/src/core/parser.js†L29-L36】
- `extractComments()` reads `parseResult.sourceCode || ''` and slices using that string.【F:daedalus-parser/src/core/parser.js†L93-L101】

**Impact**
- Consumers calling `extractComments(parser.parse(code))` get structurally valid objects but empty/incorrect `text` and `content`.

**Recommendation**
- Either persist `sourceCode` in parse results, or derive comment text directly from `node.text`.

---

### 2) Throughput metric can become `Infinity`/unstable on very fast parses (medium)

**What happens**
- Throughput is `sourceCode.length / parseTimeMs * 1000` with no zero guard.

**Evidence**
- Calculation has no min clamp for `parseTimeMs`【F:daedalus-parser/src/core/parser.js†L27-L36】.

**Impact**
- Telemetry can produce `Infinity` or very noisy values for tiny files/high-performance hosts.

**Recommendation**
- Clamp denominator (`Math.max(parseTimeMs, epsilon)`) and/or expose raw nanoseconds for stable downstream handling.

---

### 3) String argument decoding strips internal quotes (high)

**What happens**
- Both action and condition argument parsing use `child.text.replace(/"/g, '')`.
- This removes **all** quotes, not just enclosing delimiters.

**Evidence**
- Action parser argument normalization.【F:daedalus-parser/src/semantic/parsers/action-parsers.ts†L240-L247】
- Condition parser argument normalization.【F:daedalus-parser/src/semantic/parsers/condition-parsers.ts†L122-L129】

**Impact**
- Literal payloads containing escaped/internal quotes are corrupted.
- Formatting roundtrip and semantic fidelity degrade.

**Recommendation**
- Reuse the safer outer-quote-only logic already present in `normalizeArgumentText` (or centralize shared string-decoding helper).

---

### 4) Binary condition parser has operand-position assumption (medium)

**What happens**
- `parseBinaryExpression` only emits `VariableCondition` when `left.type === 'identifier'`.
- Comments already acknowledge the limitation.

**Evidence**
- Assumption and guard in binary parser.【F:daedalus-parser/src/semantic/parsers/condition-parsers.ts†L54-L69】

**Impact**
- Semantically valid conditions with reversed operands (or more complex left expressions) silently fallback to generic/raw condition models.
- This leads to inconsistent condition model shape for equivalent logic.

**Recommendation**
- Normalize comparisons by detecting identifier on either side, or represent binary conditions in a richer typed node that preserves both operands.

---

### 5) Duplicated argument parsing logic in two modules (maintenance risk)

**What happens**
- `parseArguments` is duplicated in `ActionParsers` and `ConditionParsers`, including identical filtering/quote behavior.

**Evidence**
- Action parser duplicate helper.【F:daedalus-parser/src/semantic/parsers/action-parsers.ts†L237-L249】
- Condition parser duplicate helper.【F:daedalus-parser/src/semantic/parsers/condition-parsers.ts†L119-L131】

**Impact**
- Bug fixes (like quote handling) must be applied in two places and can drift over time.

**Recommendation**
- Extract a shared argument tokenizer/normalizer utility in `src/semantic/parsers` or `src/utils`.

---

### 6) Inconsistent string normalization paths in `ActionParsers` (maintenance + subtle behavior drift)

**What happens**
- Most action parsers rely on `parseArguments` (global quote stripping).
- `parseInfoAddChoiceCall` uses `namedChildren` + `normalizeArgumentText` (outer-quote trimming only).

**Evidence**
- Mixed strategy in same class.【F:daedalus-parser/src/semantic/parsers/action-parsers.ts†L106-L127】【F:daedalus-parser/src/semantic/parsers/action-parsers.ts†L240-L257】

**Impact**
- Similar action signatures can be normalized differently depending on code path.

**Recommendation**
- Adopt a single normalization pipeline for all action argument extraction.

---

### 7) Shared singleton parser in utilities may create hidden coupling (low/medium)

**What happens**
- `createDaedalusParser` returns a module-level cached parser instance.

**Evidence**
- Global `cachedParser` and reuse path.【F:daedalus-parser/src/utils/parser-utils.ts†L8-L24】

**Impact**
- Implicit shared mutable state across callers/tests; risky if parse options or concurrent workflows evolve.

**Recommendation**
- Prefer factory-per-request for isolation, or explicitly document/thread-safe guard usage constraints.

---

### 8) `parseFile` option contract mismatch (`detectEncoding` documented, not used) (low)

**What happens**
- JSDoc advertises `options.detectEncoding`.
- Method always auto-detects unless explicit `encoding` is provided; `detectEncoding` is ignored.

**Evidence**
- Option documented in JSDoc.【F:daedalus-parser/src/core/parser.js†L49-L52】
- Runtime logic has no branch on `detectEncoding`.【F:daedalus-parser/src/core/parser.js†L66-L78】

**Impact**
- API consumers may think they can disable detection, but cannot.

**Recommendation**
- Implement option behavior or remove it from docs.

---

## Suggested remediation order

1. Fix comment extraction bug (#1).  
2. Fix quote handling + deduplicate argument parsing (#3 + #5 + #6).  
3. Harden condition binary parsing (#4).  
4. Tighten metrics/options correctness (#2 + #8).  
5. Revisit parser singleton strategy if concurrency/isolation requirements expand (#7).
