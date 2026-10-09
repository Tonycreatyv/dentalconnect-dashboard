/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAX_IMAGE_BYTES, validateImageFile } from "./imageValidation.ts";

Deno.test("accepts real JPG/PNG/WebP under the size limit", () => {
  assertEquals(validateImageFile({ type: "image/jpeg", size: 1024 }), null);
  assertEquals(validateImageFile({ type: "image/png", size: 1024 }), null);
  assertEquals(validateImageFile({ type: "image/webp", size: 1024 }), null);
});

Deno.test("rejects unsupported formats with a plain-language message", () => {
  const error = validateImageFile({ type: "application/pdf", size: 1024 });
  assertEquals(typeof error, "string");
  assertEquals(error!.toLowerCase().includes("jpg"), true);
});

Deno.test("rejects files over the 5 MB limit", () => {
  const error = validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES + 1 });
  assertEquals(typeof error, "string");
});

Deno.test("accepts a file exactly at the size limit", () => {
  assertEquals(validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES }), null);
});
