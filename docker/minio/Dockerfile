# MinIO no longer publishes public images (Docker Hub and quay.io both refuse
# anonymous pulls), so we build the server and the mc client from MinIO's own
# source at pinned release tags. One image holds both: the minio service's
# healthcheck runs `mc ready local`, and minio-init uses mc to create the bucket.
# The first `pnpm services:up` builds it (a few minutes); later runs reuse it.

ARG GO_VERSION=1.24

FROM golang:${GO_VERSION}-alpine AS build
RUN apk add --no-cache git
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
ARG MINIO_RELEASE
ARG MC_RELEASE
RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git /src/minio \
 && cd /src/minio && go build -trimpath -ldflags "-s -w" -o /out/minio .
RUN git clone --depth 1 --branch "${MC_RELEASE}" https://github.com/minio/mc.git /src/mc \
 && cd /src/mc && go build -trimpath -ldflags "-s -w" -o /out/mc .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/minio /out/mc /usr/bin/
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["minio"]
