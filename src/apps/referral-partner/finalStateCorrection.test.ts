/// <reference lib="deno.ns" />
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canCorrectFinalResult, correctionNoteIsValid } from "./finalStateCorrection.ts";

Deno.test("only final result states expose controlled correction", () => {
  assert(canCorrectFinalResult("converted"));
  assert(canCorrectFinalResult("not_converted"));
  for (const status of ["new", "follow_up", "contacted", "in_progress", "appointment_scheduled"]) assertEquals(canCorrectFinalResult(status), false);
});

Deno.test("marked_by_mistake and new_information never require a note, even blank", () => {
  assert(correctionNoteIsValid("marked_by_mistake", ""));
  assert(correctionNoteIsValid("marked_by_mistake", "   "));
  assert(correctionNoteIsValid("new_information", ""));
  assert(correctionNoteIsValid("new_information", "   "));
});

Deno.test("other requires a non-blank note", () => {
  assertEquals(correctionNoteIsValid("other", ""), false);
  assertEquals(correctionNoteIsValid("other", "   "), false);
  assert(correctionNoteIsValid("other", "El cliente compartió información nueva."));
});
