# Diet Pro build. `make` produces ./dist/dietpro for this machine;
# `make release` cross-compiles for macOS, Linux and Windows.
# The frontend is built once and embedded; Go needs no cgo, so cross-builds just work.

VERSION ?= $(shell date +%Y.%m.%d)
LDFLAGS := -s -w -X main.version=$(VERSION)
LEGACY  ?= ../DIETPRO_RECOVERY/DietProExport
IMAGES  ?= ../program files/Radium Technologies/Diet Pro/Images
PLATFORMS := darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64

.PHONY: all web build release import run dev clean test

all: build

web/node_modules: web/package.json
	cd web && npm install --no-audit --no-fund
	@touch $@

web/dist/index.html: web/node_modules $(shell find web/src -type f) web/index.html web/vite.config.ts
	cd web && npm run build

web: web/dist/index.html

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o dist/dietpro .

release: web
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; ext=$$( [ $$os = windows ] && echo .exe ); \
		echo "building $$os/$$arch"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" \
			-o dist/dietpro-$(VERSION)-$$os-$$arch$$ext . || exit 1; \
	done

# Create dist/dietpro.db from the legacy CSV export and image folder.
import: build
	./dist/dietpro import -csv "$(LEGACY)" -images "$(IMAGES)" -db dist/dietpro.db -force

run: build
	./dist/dietpro serve -db dist/dietpro.db -open

# Hot-reloading UI on :5173, proxying the API to a server on :7465.
dev:
	@echo "Run './dist/dietpro serve -db dist/dietpro.db' in another terminal."
	cd web && npm run dev

test:
	go vet ./...
	go test ./...
	cd web && npm run typecheck

clean:
	rm -rf dist web/dist
