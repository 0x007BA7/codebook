# PR Linearizer — single source of truth for the build/test loop (§13.2).
# Every target exits nonzero on failure so the agent loop can read exit codes.
.DEFAULT_GOAL := help
.PHONY: help setup install uninstall build typecheck lint test e2e verify eval serve demo \
        golden-update new-fixture gen-large status clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install dependencies
	npm install

install: setup ## Install deps + put `prl-review` on your PATH (run PRs from any repo)
	bash scripts/install.sh

uninstall: ## Remove the `prl-review` symlink from your PATH
	@for d in /usr/local/bin /opt/homebrew/bin "$$HOME/.local/bin" "$$PREFIX"; do \
	  [ -L "$$d/prl-review" ] && rm -f "$$d/prl-review" && echo "removed $$d/prl-review"; \
	done; true

build: ## Build the web app (other packages run from TS source via tsx/vitest)
	npm run build --workspace @prl/web

typecheck: ## tsc --noEmit across every package (per-package lib isolation)
	node scripts/typecheck.mjs

lint: ## eslint + the §11.6 dependency-cruiser boundary check
	npx eslint .
	npx depcruise --config .dependency-cruiser.cjs packages

test: ## All Vitest unit/property/golden/contract/spine tests (no network)
	npx vitest run

e2e: ## Spine render smoke (static markup; browser-driven Playwright deferred)
	npx vitest run packages/web

verify: ## THE LOOP GATE: typecheck && lint && test. Exits nonzero on any failure.
	$(MAKE) typecheck
	$(MAKE) lint
	$(MAKE) test

eval: ## Run the eval harness; write eval/scorecard.json + eval/report.html
	npx tsx packages/cli/src/eval.ts

serve: ## Start the Fastify server (PORT env overrides; default 8787)
	npx tsx packages/server/src/main.ts

demo: ## Start server + web on the rate-limit fixture, open the browser
	npx tsx scripts/demo.ts

golden-update: ## Regenerate every fixture's expected.plan.json (review the diff!)
	npx tsx scripts/golden-update.ts

new-fixture: ## Scaffold a fixture: make new-fixture name=foo
	npx tsx scripts/new-fixture.ts $(name)

gen-large: ## Regenerate the seeded large-synthetic fixture input
	npx tsx scripts/gen-large.ts

status: ## Regenerate STATUS.md by running the milestone smoke checks
	npx tsx scripts/status.ts

clean: ## Remove build artifacts
	rm -rf packages/web/dist eval/report.html eval/scorecard.json test-results
