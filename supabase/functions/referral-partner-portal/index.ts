import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function response(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://referral.creatyv.io","access-control-allow-headers":"content-type"}});}
async function hash(token:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");}
const ACTIONS=new Set(["accept","reject","contacted","appointment_scheduled","in_progress","converted","not_converted","closed"]);
const WORK_ACTIONS=new Set(["contacted","appointment_scheduled","in_progress","converted","not_converted","closed"]);
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":"https://referral.creatyv.io","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type"}});
 if(req.method!=="POST")return response(405,{success:false,error:"method_not_allowed"});
 try{
  const body=await req.json(); const token=String(body.token??"").trim(); const action=String(body.action??"view").trim(); const reason=String(body.reason??"").trim().slice(0,1000);
  if(token.length<32)return response(401,{success:false,error:"invalid_portal_token"});
  const client=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
  const tokenResult=await client.from("referral_partner_access_tokens").select("id,organization_id,assignment_id,partner_id,expires_at,revoked_at").eq("token_hash",await hash(token)).maybeSingle();
  const access=tokenResult.data; if(!access||access.revoked_at||+new Date(access.expires_at)<=Date.now())return response(401,{success:false,error:"portal_token_expired_or_revoked"});
  const assignmentResult=await client.from("referral_assignments").select("id,status,work_status,assigned_at,acceptance_deadline,request_id,partner_id").eq("id",access.assignment_id).eq("partner_id",access.partner_id).single();
  if(assignmentResult.error)return response(404,{success:false,error:"assignment_not_found"}); const assignment=assignmentResult.data;
  if(action!=="view"){
   if(!ACTIONS.has(action))return response(400,{success:false,error:"unsupported_action"});
   if(action==="reject"&&!reason)return response(400,{success:false,error:"rejection_reason_required"});
   if(action==="accept"&&assignment.status!=="assigned"||action==="reject"&&assignment.status!=="assigned")return response(409,{success:false,error:"invalid_assignment_transition"});
   if(WORK_ACTIONS.has(action)&&assignment.status!=="accepted")return response(409,{success:false,error:"invalid_assignment_transition"});
   const updates:any={updated_at:new Date().toISOString()};
   if(action==="accept")Object.assign(updates,{status:"accepted",accepted_at:new Date().toISOString()}); else if(action==="reject")Object.assign(updates,{status:"rejected",rejected_at:new Date().toISOString(),rejection_reason:reason}); else updates.work_status=action;
   const changed=await client.from("referral_assignments").update(updates).eq("id",assignment.id).eq("partner_id",access.partner_id).select("id,status,work_status").single(); if(changed.error)throw changed.error;
   const eventAction=action==="accept"?"accepted":action==="reject"?"rejected":action;
   await client.from("referral_operational_events").insert({organization_id:access.organization_id,aggregate_type:"assignment",aggregate_id:assignment.id,event_type:`partner_${eventAction}`,actor_type:"partner",source:"partner_portal",metadata:reason?{reason}: {}});
   await client.from("referral_partner_access_tokens").update({last_used_at:new Date().toISOString()}).eq("id",access.id);
   return response(200,{success:true,assignment:changed.data});
  }
  const requestResult=await client.from("referral_service_requests").select("id,lead_id,service_id,source_channel,city,postal_code,priority,intake_complete,intake,created_at").eq("id",assignment.request_id).single();
  const leadResult=await client.from("leads").select("full_name,first_name,last_name,phone").eq("id",requestResult.data?.lead_id).eq("organization_id",access.organization_id).single();
  const intake=requestResult.data?.intake&&typeof requestResult.data.intake==="object"?requestResult.data.intake:{};
  const customer={...leadResult.data,full_name:leadResult.data?.full_name||intake.contact_name||intake.profile_name||null,phone:leadResult.data?.phone||intake.contact_phone||null};
  const {intake:_privateIntake,...publicRequest}=requestResult.data??{};
  await client.from("referral_partner_access_tokens").update({last_used_at:new Date().toISOString()}).eq("id",access.id);
  return response(200,{success:true,assignment,request:publicRequest,customer,capabilities:Array.from(ACTIONS)});
 }catch(error){console.error("[partner-portal] failed",{error:String((error as Error).message).slice(0,250)});return response(500,{success:false,error:"partner_portal_failed"});}
});
