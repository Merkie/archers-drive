import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "R2 env vars required: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
      );
    }

    s3Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3Client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET env var is required");
  return bucket;
}

function getCdnBase(): string {
  return (process.env.R2_CDN_URL ?? "").replace(/\/$/, "");
}

/**
 * Public CDN url for a stored object. Security-through-obscurity:
 * the storageKey contains an unguessable cuid, and the bucket has no listing.
 */
export function publicUrlFor(storageKey: string): string {
  const base = getCdnBase();
  if (!base) return "";
  return `${base}/${storageKey}`;
}

export async function uploadBuffer(
  storageKey: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function downloadBuffer(storageKey: string): Promise<Buffer> {
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: storageKey })
  );
  if (!res.Body) throw new Error(`R2 object missing: ${storageKey}`);
  const stream = res.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(storageKey: string): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: storageKey })
  );
}

/**
 * Short-lived signed download URL. Used by /v1/files/read with returnType: "url".
 * The CDN URL is also valid, but this gives an expiring link straight from R2
 * for clients that prefer not to depend on the CDN host.
 */
export async function signedDownloadUrl(
  storageKey: string,
  expiresInSeconds = 300
): Promise<string> {
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: getBucket(), Key: storageKey }),
    { expiresIn: expiresInSeconds }
  );
}
