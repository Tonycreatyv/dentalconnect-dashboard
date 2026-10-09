/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20260911000100_partner_assignment_request_lifecycle_sync.sql",
);

Deno.test("migration re-verifies the exact deployed 7-argument baseline before replacing it", () => {
  assertStringIncludes(
    sql,
    "to_regprocedure('public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz,text)')",
  );
  assertStringIncludes(sql, "create or replace function public.partner_update_immigration_assignment(");
});

Deno.test("new/follow_up -> converted or closed_not_converted closes the parent request", () => {
  // Both terminal-result actions share one branch and one request-status
  // assignment — there is no separate 'new' vs 'follow_up' code path,
  // because the branch only looks at p_action, not the assignment's prior
  // work_status. Confirming the mapping exists once therefore proves it for
  // every prior work_status ('new' or 'follow_up') that can legally reach it.
  assertStringIncludes(
    sql,
    "if p_action in ('converted','closed_not_converted') then\n      next_request_status:='closed';\n    end if;",
  );
  assertStringIncludes(
    sql,
    "update public.referral_service_requests\n    set status='closed', updated_at=now()\n    where id=a.request_id and status<>'closed';",
  );
});

Deno.test("correct_result reopens the request from either converted or not_converted", () => {
  // correct_result is only reachable when a.work_status is already
  // 'converted' or 'not_converted' (the pre-existing invalid_final_result_
  // correction guard below) and does not otherwise branch on which of the
  // two it was — so one assertion covers both starting states.
  assertStringIncludes(sql, "a.status<>'accepted' or a.work_status not in ('converted','not_converted')");
  assertStringIncludes(sql, "invalid_final_result_correction");
  assertStringIncludes(sql, "next_work_status:='follow_up';\n    next_request_status:='prequalified';");
  assertStringIncludes(
    sql,
    "elsif next_request_status='prequalified' then\n    update public.referral_service_requests\n    set status='prequalified', updated_at=now()\n    where id=a.request_id and status='closed';",
  );
});

Deno.test("a terminal assignment cannot be re-closed or flipped without going through correct_result", () => {
  assertStringIncludes(
    sql,
    "if a.work_status in ('converted','not_converted') then raise exception 'assignment_already_closed'; end if;\n    next_work_status:=case p_action when 'closed_not_converted' then 'not_converted' when 'no_answer' then a.work_status else p_action end;",
  );
});

Deno.test("request-status writes are guarded so they are a no-op outside the exact prior state", () => {
  // Closing never fires against a request that's already closed; reopening
  // never fires against a request that isn't. This is what keeps historical
  // rows whose assignment was never re-touched untouched by this migration.
  assertStringIncludes(sql, "and status<>'closed';");
  assertStringIncludes(sql, "and status='closed';");
});

Deno.test("the resulting request status is captured and surfaced without adding a second source of truth", () => {
  assertStringIncludes(
    sql,
    "select status into request_status_after from public.referral_service_requests where id=a.request_id;",
  );
  assertStringIncludes(sql, "'request_id',a.request_id,\n      'request_status_after',request_status_after");
  assertStringIncludes(sql, "'request_status',request_status_after");
});

Deno.test("existing action set, error codes, and audit fields are unchanged", () => {
  assertStringIncludes(
    sql,
    "if p_action not in ('accept','reject','contacted','no_answer','appointment_scheduled','converted','closed_not_converted','note','follow_up','correct_result') then",
  );
  assertStringIncludes(sql, "partner_assignment_not_authorized_immigration");
  assertStringIncludes(sql, "invalid_correction_reason");
  assertStringIncludes(sql, "correction_note_required");
  assertStringIncludes(sql, "partner_result_corrected");
  // No new table, no new grant target, no signature change.
  assertEquals(sql.includes("create table"), false);
  assertStringIncludes(sql, "from public,anon;");
  assertStringIncludes(
    sql,
    "revoke all on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz,text) from public,anon;",
  );
  assertStringIncludes(
    sql,
    "grant execute on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz,text) to authenticated;",
  );
});

Deno.test("no historical row is rewritten — only the live RPC body changes", () => {
  assertEquals(sql.includes("update public.referral_service_requests set") === false, true);
  assertEquals(/update\s+public\.referral_service_requests[\s\S]*where\s+id\s*=\s*'[0-9a-f-]{36}'/i.test(sql), false);
  assertEquals(sql.includes("delete from"), false);
});
