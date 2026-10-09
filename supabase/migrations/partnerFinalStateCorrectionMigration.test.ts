/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile("supabase/migrations/20260908000100_partner_final_state_correction.sql");

Deno.test("final-state correction migration preserves the existing RPC path and audits the correction", () => {
  assertStringIncludes(sql, "drop function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz)");
  assertStringIncludes(sql, "p_correction_reason text default null");
  assertStringIncludes(sql, "p_action='correct_result'");
  assertStringIncludes(sql, "a.work_status not in ('converted','not_converted')");
  assertStringIncludes(sql, "next_work_status:='follow_up'");
  assertStringIncludes(sql, "when p_action='correct_result' then null");
  assertStringIncludes(sql, "partner_result_corrected");
  assertStringIncludes(sql, "'from_work_status'");
  assertStringIncludes(sql, "'correction_reason'");
});

Deno.test("final-state correction migration rejects final-to-final and an invalid/missing reason", () => {
  assertStringIncludes(sql, "invalid_final_result_correction");
  assertStringIncludes(sql, "invalid_correction_reason");
  assertStringIncludes(sql, "follow_up_attempt_count=case when p_action='follow_up' then follow_up_attempt_count+1 else follow_up_attempt_count end");
});

Deno.test("note is required only for 'other' — marked_by_mistake/new_information may submit blank", () => {
  assertStringIncludes(
    sql,
    "if p_correction_reason = 'other' and nullif(trim(coalesce(p_note,'')),'') is null then",
  );
  assertStringIncludes(sql, "correction_note_required");
  // The guard must be scoped to 'other' specifically, not a bare blank-note
  // check that would apply to every reason.
  assertEquals(
    sql.includes("if nullif(trim(coalesce(p_note,'')),'') is null then\n      raise exception 'correction_note_required'"),
    false,
  );
});
