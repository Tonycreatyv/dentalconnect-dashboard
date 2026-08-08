import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

Deno.test("partner portal uses persisted intake contact fallbacks without exposing raw intake", () => {
  assertStringIncludes(source, "intake.contact_name");
  assertStringIncludes(source, "intake.profile_name");
  assertStringIncludes(source, "intake.contact_phone");
  assertStringIncludes(source, "{intake:_privateIntake,...publicRequest}");
  assertStringIncludes(source, "request:publicRequest,customer");
  assert(!source.includes("request:requestResult.data,customer"));
});
