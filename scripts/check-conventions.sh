#!/usr/bin/env bash
#
# check-conventions.sh — mechanized Constitution checks (Part IV, §18).
# Scans src/ (backend) and frontend/src/ (frontend), printing the §ID next to
# each finding. With --strict, BACKEND violations of the core checks exit non-zero
# (the CI gate). Frontend checks are advisory until the FE remediation lands.
#
# Core 🔎 checks: file > ~800 lines (§2.4/§13.1); console.* in src (§9.1/§17.1);
# db()/raw outside models/ (§7.4/§10.2); raw fetch/axios outside api/index.ts
# (§14.2); : any / as any in frontend (§17.2).
# Tier A advisory greps: dangerouslySetInnerHTML (§17.4); JWT read outside the
# api client (§17.5); process.env in FE (§17.3); focused/skipped tests (§20.3);
# routes without inline auth (§11.1); models without a tenant-scope column (§11.7).

set -uo pipefail

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_SRC="$ROOT/src"
FRONTEND_SRC="$ROOT/frontend/src"
HARD_CEILING=800

backend_violations=0
advisory_count=0

red()    { printf "\033[31m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
bold()   { printf "\033[1m%s\033[0m\n" "$1"; }

# A backend hard violation: print + increment the strict counter.
violate_be() {
  red "  ✗ $1"
  backend_violations=$((backend_violations + 1))
}
# Frontend / advisory finding: print, never fails --strict.
advise() {
  yellow "  ⚠ $1"
  advisory_count=$((advisory_count + 1))
}

# Files to scan, NUL-safe, excluding build/deps and this script's own matches.
be_ts_files() { find "$BACKEND_SRC" -type f -name "*.ts" 2>/dev/null; }
fe_ts_files() { find "$FRONTEND_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null; }

# Drop grep "file:line:content" rows whose code portion is a comment line
# (starts with //, *, or /*). Prevents matching a §ID example inside a doc
# comment as if it were real code. Coarse — single-line comment lead only.
strip_comments() {
  grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)"
}

bold "== Constitution checks (§18) =="

# ---------------------------------------------------------------------------
# §2.4 / §13.1 — hard ceiling ~800 lines (both trees; backend strict)
# ---------------------------------------------------------------------------
bold "[§2.4/§13.1] File size ceiling (${HARD_CEILING} lines)"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt "$HARD_CEILING" ]; then
    violate_be "§2.4 — ${f#"$ROOT"/}:${lines} lines exceeds ${HARD_CEILING} ceiling → decompose."
  fi
done < <(be_ts_files)
while IFS= read -r f; do
  [ -z "$f" ] && continue
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt "$HARD_CEILING" ]; then
    advise "§13.1 — ${f#"$ROOT"/}:${lines} lines exceeds ${HARD_CEILING} ceiling (frontend, advisory)."
  fi
done < <(fe_ts_files)

# ---------------------------------------------------------------------------
# §9.1 / §17.1 — no console.* in src (backend strict, frontend advisory)
# ---------------------------------------------------------------------------
bold "[§9.1/§17.1] console.* in source"
if [ -d "$BACKEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    violate_be "§9.1 — ${line#"$ROOT"/} uses console.* → use the Pino logger."
  done < <(grep -rnE "console\.(log|info|warn|error|debug|trace)" "$BACKEND_SRC" \
            --include="*.ts" 2>/dev/null | grep -vE "\.test\.ts|/__tests__/" | strip_comments)
fi
if [ -d "$FRONTEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    advise "§17.1 — ${line#"$ROOT"/} uses console.* (frontend, advisory)."
  done < <(grep -rnE "console\.(log|info|warn|error|debug|trace)" "$FRONTEND_SRC" \
            --include="*.ts" --include="*.tsx" 2>/dev/null | grep -vE "\.test\.|/__tests__/" | strip_comments)
fi

# ---------------------------------------------------------------------------
# §7.4 — DB QUERIES outside models/ (backend strict)
# Flags an actual query builder call — db("table"...) or a chained .where/
# .insert/.update/.delete/.select — outside models/. Pool LIFECYCLE (db.destroy,
# db.migrate) and importing the handle to pass it along are §10.6, not queries,
# so the entry point and test setup are not violations.
# ---------------------------------------------------------------------------
bold "[§7.4] DB queries outside models/"
if [ -d "$BACKEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="${line%%:*}"
    case "$file" in
      */models/*) : ;;          # allowed — all queries live here
      */database/*) : ;;        # connection.ts defines the pool
      */test/*|*.test.ts) : ;;  # test setup may seed/clean via db()
      *) violate_be "§7.4 — ${file#"$ROOT"/} runs a query outside models/ → move it into a model." ;;
    esac
  done < <(grep -rnE "\bdb\(\s*[\"'\`]|\bdb\([^)]*\)\.(where|insert|update|del|delete|select|first|count|join)" \
            "$BACKEND_SRC" --include="*.ts" 2>/dev/null | grep -vE "\.test\.ts|/__tests__/")
fi

# ---------------------------------------------------------------------------
# §10.2 — .raw( outside models/ (advisory Tier A)
# ---------------------------------------------------------------------------
bold "[§10.2] knex .raw( outside models/ (advisory)"
if [ -d "$BACKEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="${line%%:*}"
    case "$file" in
      */models/*) : ;;
      *) advise "§10.2 — ${file#"$ROOT"/} calls .raw( outside models/ — parameterize and move." ;;
    esac
  done < <(grep -rnE "\.raw\(" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
            | grep -vE "\.test\.ts|/__tests__/" | strip_comments)
fi

# ---------------------------------------------------------------------------
# §14.2 — raw fetch/axios outside api/index.ts (frontend advisory)
# ---------------------------------------------------------------------------
bold "[§14.2] raw fetch/axios outside api/index.ts (frontend, advisory)"
if [ -d "$FRONTEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="${line%%:*}"
    case "$file" in
      */api/index.ts) : ;; # the one sanctioned fetch path
      *) advise "§14.2 — ${file#"$ROOT"/} calls fetch/axios directly → route through api/index.ts." ;;
    esac
  done < <(grep -rnE "(^|[^a-zA-Z])(fetch\(|axios)" "$FRONTEND_SRC" \
            --include="*.ts" --include="*.tsx" 2>/dev/null | grep -vE "\.test\.|/__tests__/" | strip_comments)
fi

# ---------------------------------------------------------------------------
# §17.2 — : any / as any in frontend (frontend advisory)
# ---------------------------------------------------------------------------
bold "[§17.2] : any / as any in frontend (advisory)"
if [ -d "$FRONTEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    advise "§17.2 — ${line#"$ROOT"/} uses any → type it (unknown + narrow before any)."
  done < <(grep -rnE ":\s*any\b|as\s+any\b" "$FRONTEND_SRC" \
            --include="*.ts" --include="*.tsx" 2>/dev/null | grep -vE "\.test\.|/__tests__/" | strip_comments)
fi

# ---------------------------------------------------------------------------
# §17.4 — dangerouslySetInnerHTML (frontend advisory)
# ---------------------------------------------------------------------------
bold "[§17.4] dangerouslySetInnerHTML (frontend, advisory)"
if [ -d "$FRONTEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    advise "§17.4 — ${line#"$ROOT"/} uses dangerouslySetInnerHTML → sanitize the input first."
  done < <(grep -rn "dangerouslySetInnerHTML" "$FRONTEND_SRC" \
            --include="*.tsx" --include="*.ts" 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# §17.5 / §17.3 — JWT read or process.env in the FE bundle (advisory)
# ---------------------------------------------------------------------------
bold "[§17.3/§17.5] secrets/env in the frontend bundle (advisory)"
if [ -d "$FRONTEND_SRC" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="${line%%:*}"
    case "$file" in
      */api/index.ts) : ;;
      *) advise "§17.5 — ${file#"$ROOT"/} reads a token outside the api client → use the one path." ;;
    esac
  done < <(grep -rnE "localStorage\.getItem\(|auth_token|getItem\(\"token" "$FRONTEND_SRC" \
            --include="*.ts" --include="*.tsx" 2>/dev/null | grep -vE "\.test\." | strip_comments)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    advise "§17.3 — ${line#"$ROOT"/} reads process.env in the bundle → use VITE_ vars."
  done < <(grep -rnE "process\.env" "$FRONTEND_SRC" \
            --include="*.ts" --include="*.tsx" 2>/dev/null | grep -vE "\.test\." | strip_comments)
fi

# ---------------------------------------------------------------------------
# §20.3 — focused/skipped tests (both trees, advisory)
# ---------------------------------------------------------------------------
bold "[§20.3] focused/skipped tests (advisory)"
for tree in "$BACKEND_SRC" "$FRONTEND_SRC"; do
  [ -d "$tree" ] || continue
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    advise "§20.3 — ${line#"$ROOT"/} has a focused/skipped test → remove before merge."
  done < <(grep -rnE "\.(only|skip)\(|xit\(|xdescribe\(" "$tree" \
            --include="*.test.ts" --include="*.test.tsx" 2>/dev/null)
done

# ---------------------------------------------------------------------------
# §11.1 — route file with no inline auth reference (backend advisory)
# ---------------------------------------------------------------------------
bold "[§11.1] route files without inline auth (advisory)"
if [ -d "$BACKEND_SRC/routes" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! grep -qE "authenticate|ownerContext|requireAuth|rbac|auth" "$f" 2>/dev/null; then
      advise "§11.1 — ${f#"$ROOT"/} has no inline auth — confirm it is a public endpoint."
    fi
  done < <(find "$BACKEND_SRC/routes" -type f -name "*.ts" 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# §11.7 — tenant/owner-scope heuristic on models (backend advisory)
# ---------------------------------------------------------------------------
bold "[§11.7] models without an owner/tenant-scope reference (advisory)"
if [ -d "$BACKEND_SRC/models" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    base="$(basename "$f")"
    # BaseModel + leaf tables reached via an owner-verified parent are expected
    # to lack a direct owner column; surface for review, never fail.
    case "$base" in
      BaseModel.ts|HealthModel.ts) continue ;;
    esac
    if ! grep -qE "owner_user_id|organization_id|session_id|OwnerContext" "$f" 2>/dev/null; then
      advise "§11.7 — ${f#"$ROOT"/} queries without an owner/tenant column — review scope."
    fi
  done < <(find "$BACKEND_SRC/models" -type f -name "*.ts" ! -name "*.test.ts" 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
bold "== Summary =="
echo "  Backend hard violations: ${backend_violations}"
echo "  Advisory findings:       ${advisory_count}"

if [ "$STRICT" -eq 1 ] && [ "$backend_violations" -gt 0 ]; then
  red "FAILED (--strict): ${backend_violations} backend violation(s) must be fixed."
  exit 1
fi

if [ "$backend_violations" -eq 0 ]; then
  green "Backend convention checks passed."
else
  yellow "Backend violations present (non-strict run; not failing)."
fi
exit 0
