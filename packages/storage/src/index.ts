/**
 * @workspace/storage — S3-compatible object storage (MinIO locally) for
 * Organization logos and Quote Documents. Postgres keeps only object keys.
 *
 * - `createS3Storage(env?)`: the real store, configured from the S3_* env
 *   (path-style for MinIO). Server only.
 * - `createMemoryStorage()`: an in-memory fake with the same interface, for
 *   tests (`objects` holds what was stored).
 * - `organizationObjectKey(organizationId, area, name)` builds keys under
 *   `organizations/<id>/<area>/`, and `isOrganizationObjectKey` checks one, so
 *   a caller can never point a record at another Organization's object.
 *
 * Browsers never receive credentials: they upload with a presigned PUT
 * (`presignPut`, which pins the Content-Type and Content-Length) and read with
 * a presigned GET (`presignGet`).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { storageEnv } from "./env"
import type { StorageEnv } from "./env"

export interface StoredObjectInfo {
  key: string
  contentType: string | undefined
  /** Bytes. */
  size: number
}

export interface StoredObject extends StoredObjectInfo {
  body: Uint8Array
}

export interface PresignedUpload {
  /** PUT the file's bytes here. */
  url: string
  /** Headers the PUT must carry exactly as given (they are signed). */
  headers: Record<string, string>
}

/** Default lifetime of presigned URLs: 15 minutes. */
export const PRESIGN_EXPIRES_IN_SECONDS = 15 * 60

export interface ObjectStorage {
  put(
    key: string,
    body: Uint8Array | string,
    opts: { contentType: string }
  ): Promise<void>
  /** The object with its bytes, or `null` when there is none. */
  get(key: string): Promise<StoredObject | null>
  /** The object's metadata, or `null` when there is none. */
  head(key: string): Promise<StoredObjectInfo | null>
  /** Removes the object; a missing object is not an error. */
  delete(key: string): Promise<void>
  /** A URL a browser can PUT exactly `size` bytes of `contentType` to. */
  presignPut(
    key: string,
    opts: { contentType: string; size: number; expiresIn?: number }
  ): Promise<PresignedUpload>
  /** A URL a browser can GET the object from. */
  presignGet(
    key: string,
    opts?: { expiresIn?: number; downloadName?: string }
  ): Promise<string>
}

type S3Env = Pick<
  StorageEnv,
  | "S3_ENDPOINT"
  | "S3_REGION"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
  | "S3_BUCKET"
  | "S3_FORCE_PATH_STYLE"
>

function contentDisposition(downloadName: string) {
  const ascii = downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
}

const isMissing = (error: unknown) =>
  error instanceof NoSuchKey ||
  error instanceof NotFound ||
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode === 404

/** The S3-compatible store from the S3_* env. The client is created on first use. */
export function createS3Storage(env: S3Env = storageEnv()): ObjectStorage {
  let client: S3Client | undefined
  const s3 = () =>
    (client ??= new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      // Only checksum when S3 requires it: a presigned PUT must not pin the
      // checksum of an empty body.
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }))
  const Bucket = env.S3_BUCKET

  return {
    async put(key, body, { contentType }) {
      await s3().send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      )
    },

    async get(key) {
      try {
        const out = await s3().send(new GetObjectCommand({ Bucket, Key: key }))
        const body = await out.Body!.transformToByteArray()
        return {
          key,
          contentType: out.ContentType,
          size: body.byteLength,
          body,
        }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    async head(key) {
      try {
        const out = await s3().send(new HeadObjectCommand({ Bucket, Key: key }))
        return {
          key,
          contentType: out.ContentType,
          size: out.ContentLength ?? 0,
        }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    async delete(key) {
      await s3().send(new DeleteObjectCommand({ Bucket, Key: key }))
    },

    async presignPut(key, { contentType, size, expiresIn }) {
      const url = await getSignedUrl(
        s3(),
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: size,
        }),
        {
          expiresIn: expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS,
          // Sign both, so the upload can't swap the type or exceed the size.
          signableHeaders: new Set(["content-type", "content-length"]),
        }
      )
      // Browsers set Content-Length themselves (from the body); it must
      // equal `size`, which the signature pins.
      return { url, headers: { "Content-Type": contentType } }
    },

    presignGet(key, opts = {}) {
      return getSignedUrl(
        s3(),
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: opts.downloadName
            ? contentDisposition(opts.downloadName)
            : undefined,
        }),
        { expiresIn: opts.expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS }
      )
    },
  }
}

/** Where `createMemoryStorage` pretends objects live (presigned URLs). */
export const MEMORY_STORAGE_ORIGIN = "https://storage.memory.test"

/**
 * An in-memory `ObjectStorage` for tests. `objects` maps key → object. Presigned
 * URLs point at `MEMORY_STORAGE_ORIGIN/<key>` and do nothing by themselves;
 * simulate the browser's upload with `put`.
 */
export function createMemoryStorage(): ObjectStorage & {
  objects: Map<string, StoredObject>
} {
  const objects = new Map<string, StoredObject>()
  const url = (key: string, query: Record<string, string>) => {
    const u = new URL(`${MEMORY_STORAGE_ORIGIN}/${key}`)
    for (const [name, value] of Object.entries(query)) {
      u.searchParams.set(name, value)
    }
    return u.toString()
  }
  return {
    objects,
    async put(key, body, { contentType }) {
      const bytes =
        typeof body === "string" ? new TextEncoder().encode(body) : body
      objects.set(key, {
        key,
        contentType,
        size: bytes.byteLength,
        body: bytes,
      })
    },
    async get(key) {
      return objects.get(key) ?? null
    },
    async head(key) {
      const object = objects.get(key)
      if (!object) return null
      return {
        key: object.key,
        contentType: object.contentType,
        size: object.size,
      }
    },
    async delete(key) {
      objects.delete(key)
    },
    async presignPut(key, { contentType, size }) {
      return {
        url: url(key, { method: "PUT", size: String(size) }),
        headers: { "Content-Type": contentType },
      }
    },
    async presignGet(key, opts = {}) {
      return url(
        key,
        opts.downloadName
          ? { method: "GET", download: opts.downloadName }
          : { method: "GET" }
      )
    },
  }
}

const KEY_AREA = /^[a-z][a-z0-9-]*$/

/** `organizations/<organizationId>/<area>/<name>`: every Organization's objects live under its own prefix. */
export function organizationObjectKey(
  organizationId: string,
  area: string,
  name: string
) {
  if (!KEY_AREA.test(area)) throw new TypeError(`Bad key area: ${area}`)
  if (!name || name.includes("/")) throw new TypeError(`Bad key name: ${name}`)
  return `${organizationPrefix(organizationId, area)}${name}`
}

/** Is `key` one of this Organization's objects in `area` (one level deep)? */
export function isOrganizationObjectKey(
  key: string,
  organizationId: string,
  area: string
) {
  const prefix = organizationPrefix(organizationId, area)
  if (!key.startsWith(prefix)) return false
  const name = key.slice(prefix.length)
  return name.length > 0 && !name.includes("/") && !name.includes("..")
}

function organizationPrefix(organizationId: string, area: string) {
  return `organizations/${organizationId}/${area}/`
}
